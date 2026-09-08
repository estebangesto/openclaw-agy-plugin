import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_CATALOG_TTL_SECONDS = 3600;
const DEFAULT_CATALOG_TIMEOUT_MS = 10000;
const DEFAULT_JOB_TIMEOUT_SECONDS = 300;

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function failure(message) {
  return json({ ok: false, error: message });
}

function save(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, file);
}

function nonEmpty(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionalEnv(name, value) {
  return typeof value === "string" && value.length > 0 ? ["--setenv", name, value] : [];
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

function resolveExecutable(command) {
  if (isAbsolute(command)) {
    try { return realpathSync(command); } catch { return command; }
  }
  try {
    const resolved = execFileSync("which", [command], { encoding: "utf8", timeout: 5000 }).trim();
    try { return realpathSync(resolved); } catch { return resolved; }
  } catch {
    return command;
  }
}

function parseModels(output) {
  return [...new Set(output.split(/\r?\n/)
    .map(line => line.trim().split(/\s+/)[0])
    .filter(model => /^[a-z0-9][a-z0-9.-]*$/i.test(model) && model.includes("-")))]
    .sort();
}

function newestGemini(models) {
  const candidates = models.filter(model => /^gemini-\d+(?:\.\d+)?-flash-medium$/i.test(model));
  return candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
}

function createCatalog(config, agyPath) {
  let cached;
  const ttlMs = Math.max(0, Number(config.modelCatalogTtlSeconds ?? process.env.AGY_MODEL_CATALOG_TTL_SECONDS ?? DEFAULT_CATALOG_TTL_SECONDS)) * 1000;
  const timeoutMs = Number(config.catalogRefreshTimeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS);

  return function modelCatalog(force = false) {
    const now = Date.now();
    if (!force && cached && now - cached.fetchedAt < ttlMs) return cached;
    try {
      const output = execFileSync(agyPath, ["models"], {
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: process.env,
      });
      const models = parseModels(output);
      if (models.length === 0) throw new Error("agy models no devolvió modelos válidos");
      cached = { models, fetchedAt: now, source: "agy models" };
      return cached;
    } catch (error) {
      if (cached) return { ...cached, stale: true, refreshError: String(error.message).slice(0, 500) };
      throw new Error(`No se pudo actualizar el catálogo de modelos: ${String(error.message).slice(0, 500)}`);
    }
  };
}

function chooseModel(requested, configuredDefault, catalog) {
  const model = requested || configuredDefault || newestGemini(catalog.models) || catalog.models[0];
  if (!catalog.models.includes(model)) {
    throw new Error(`Modelo no disponible: ${model}. Ejecutá agy models para consultar el catálogo vigente.`);
  }
  return model;
}

function deliveryFromContext(ctx) {
  const route = ctx?.deliveryContext;
  if (!ctx?.senderIsOwner || route?.channel !== "telegram" || typeof route.to !== "string" || route.to.length === 0) return undefined;
  return Object.freeze({ channel: route.channel, to: route.to, accountId: route.accountId, threadId: route.threadId });
}

function deliver(id, job, response, route, openclawPath) {
  if (!route) return;
  const message = `Resultado de Agy (${id}):\n\n${response || "La tarea terminó sin una respuesta de texto."}`;
  const args = ["message", "send", "--channel", route.channel, "--target", route.to, "--message", message, "--json"];
  if (route.accountId) args.push("--account", route.accountId);
  if (route.threadId !== undefined && route.threadId !== null) args.push("--thread-id", String(route.threadId));
  const child = spawn(openclawPath, args, { detached: true, stdio: "ignore" });
  const update = delivery => {
    try {
      const state = JSON.parse(readFileSync(join(job, "state.json"), "utf8"));
      save(join(job, "state.json"), { ...state, delivery });
    } catch { /* The job result remains available even if delivery bookkeeping fails. */ }
  };
  child.on("error", error => update({ state: "failed", error: String(error.message).slice(0, 500) }));
  child.on("close", code => update({ state: code === 0 ? "sent" : "failed", completedAt: new Date().toISOString() }));
  child.unref();
}

function prepareProfile(profileDir) {
  for (const directory of [profileDir, join(profileDir, "profile-home"), join(profileDir, "xdg-config"), join(profileDir, "xdg-cache"), join(profileDir, "xdg-data")]) ensureDirectory(directory);
}

function run(id, prompt, model, timeoutSeconds, apiKeys, delivery, options) {
  const job = join(options.jobsRoot, id);
  ensureDirectory(options.jobsRoot);
  mkdirSync(job, { recursive: false, mode: 0o700 });
  save(join(job, "state.json"), { id, state: "running", model, createdAt: new Date().toISOString() });
  const policy = [
    "Sos un analista externo. Usá sólo información pública.",
    "No leas ni modifiques archivos locales; no uses credenciales ni envíes mensajes.",
    "Respondé en español rioplatense, con fuentes públicas y límites claros.",
  ].join(" ");
  const args = [
    "--unshare-user", "--unshare-pid", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
    "--ro-bind-try", "/usr", "/usr", "--ro-bind-try", "/bin", "/bin", "--ro-bind-try", "/lib", "/lib", "--ro-bind-try", "/lib64", "/lib64",
    "--dir", "/opt", "--dir", "/opt/agy", "--ro-bind", options.agyPath, "/opt/agy/agy", "--ro-bind-try", "/etc/ssl/certs", "/etc/ssl/certs",
    "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf", "--ro-bind-try", "/etc/hosts", "/etc/hosts",
    "--bind", join(options.profileDir, "profile-home"), "/sandbox/home", "--bind", join(options.profileDir, "xdg-config"), "/xdg/config",
    "--bind", join(options.profileDir, "xdg-cache"), "/xdg/cache", "--bind", join(options.profileDir, "xdg-data"), "/xdg/data",
    "--bind", job, "/work", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--chdir", "/work",
    "--clearenv", "--setenv", "HOME", "/sandbox/home", "--setenv", "XDG_CONFIG_HOME", "/xdg/config",
    "--setenv", "XDG_CACHE_HOME", "/xdg/cache", "--setenv", "XDG_DATA_HOME", "/xdg/data", "--setenv", "PATH", "/opt/agy:/usr/bin:/bin",
    ...optionalEnv("TAVILY_API_KEY", apiKeys.tavily), ...optionalEnv("NEWSDATA_API_KEY", apiKeys.newsdata),
    "/opt/agy/agy", "-p", `${policy}\n\nPedido: ${prompt}`, "--model", model, "--sandbox", "--disable-slash-commands",
    "--output-format", "json", "--print-timeout", `${timeoutSeconds}s`,
  ];
  const child = spawn(options.bubblewrapPath, args, { cwd: job, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  let finished = false;
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const finish = (code, spawnError) => {
    if (finished) return;
    finished = true;
    let result;
    try { result = JSON.parse(stdout); } catch { result = { response: stdout.trim() }; }
    const state = !spawnError && code === 0 && result.status === "SUCCESS" ? "succeeded" : "failed";
    save(join(job, "state.json"), { id, state, model, completedAt: new Date().toISOString(), result, error: String(spawnError?.message || stderr).trim().slice(0, 1200) || undefined, delivery: delivery ? { state: "pending", route: { channel: delivery.channel, to: delivery.to, threadId: delivery.threadId } } : { state: "not-requested" } });
    deliver(id, job, state === "succeeded" ? result.response : "La tarea no pudo completarse. Podés consultar el estado del job si necesitás el diagnóstico.", delivery, options.openclawPath);
  };
  child.on("error", error => finish(-1, error));
  child.on("close", code => finish(code));
  child.unref();
}

export default function (api = {}) {
  const configured = api.pluginConfig ?? {};
  const stateDir = nonEmpty(configured.stateDir, nonEmpty(process.env.OPENCLAW_STATE_DIR, join(homedir(), ".openclaw")));
  const options = {
    jobsRoot: nonEmpty(configured.jobsRoot, join(stateDir, "agy-jobs")),
    profileDir: nonEmpty(configured.profileDir, join(stateDir, "agy-runner")),
    agyPath: resolveExecutable(nonEmpty(configured.agyPath, nonEmpty(process.env.AGY_BIN, "agy"))),
    bubblewrapPath: resolveExecutable(nonEmpty(configured.bubblewrapPath, "bwrap")),
    openclawPath: resolveExecutable(nonEmpty(configured.openclawPath, "openclaw")),
  };
  prepareProfile(options.profileDir);
  const catalog = createCatalog(configured, options.agyPath);
  const apiKeys = Object.freeze({ tavily: configured.tavilyApiKey || process.env.TAVILY_API_KEY || "", newsdata: configured.newsdataApiKey || process.env.NEWSDATA_API_KEY || "" });
  const configuredDefault = configured.defaultModel || process.env.AGY_DEFAULT_MODEL;
  const defaultTimeout = Number(configured.jobTimeoutSeconds ?? DEFAULT_JOB_TIMEOUT_SECONDS);

  api.registerTool?.((ctx) => ({
    name: "extension_agy_submit",
    description: "Start an isolated asynchronous agy job for public web research. The model is validated against the automatically refreshed agy models catalog.",
    parameters: { type: "object", additionalProperties: false, properties: { prompt: { type: "string", minLength: 1, maxLength: 12000 }, model: { type: "string", minLength: 1 }, timeoutSeconds: { type: "integer", minimum: 30, maximum: 900 } }, required: ["prompt"] },
    async execute(_id, params) {
      const id = randomUUID();
      try {
        const available = catalog();
        const model = chooseModel(params.model, configuredDefault, available);
        const delivery = deliveryFromContext(ctx);
        run(id, params.prompt, model, params.timeoutSeconds || defaultTimeout, apiKeys, delivery, options);
        return json({ ok: true, id, state: "running", model, catalog: { source: available.source, fetchedAt: new Date(available.fetchedAt).toISOString(), stale: Boolean(available.stale) }, delivery: delivery ? "origin-topic" : "not-configured", capabilities: { tavily: Boolean(apiKeys.tavily), newsdata: Boolean(apiKeys.newsdata) } });
      } catch (error) { return failure(String(error.message)); }
    },
  }), { name: "extension_agy_submit" });

  api.registerTool?.({ name: "extension_agy_status", description: "Read the status and final result of a previously submitted isolated agy job.", parameters: { type: "object", additionalProperties: false, properties: { id: { type: "string", pattern: "^[0-9a-f-]{36}$" } }, required: ["id"] }, async execute(_id, params) { const file = join(options.jobsRoot, params.id, "state.json"); if (!existsSync(file)) return failure("Unknown job id"); try { return json({ ok: true, ...JSON.parse(readFileSync(file, "utf8")) }); } catch (error) { return failure(String(error.message)); } } });
  api.logger?.info("Agy isolated runner tools registered.");
}
