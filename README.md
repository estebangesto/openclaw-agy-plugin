# OpenClaw Agy Plugin

Plugin de OpenClaw para ejecutar investigaciones públicas asincrónicas mediante [Agy](https://github.com/google-gemini/gemini-cli) dentro de un sandbox de [Bubblewrap](https://github.com/containers/bubblewrap).

## Características

- Ejecuta cada trabajo en un proceso aislado y con capacidades Linux reducidas.
- Entrega el resultado en el topic de Telegram de origen cuando la solicitud proviene del propietario autorizado.
- No acepta archivos ni rutas locales como entrada: recibe texto y consulta información pública.
- Consulta automáticamente `agy models` y valida cada modelo contra el catálogo vigente.
- Selecciona por defecto el modelo Gemini Flash medio más reciente disponible.
- Conserva el resultado y el estado de cada job en un directorio separado.
- Permite inyectar opcionalmente claves de Tavily y NewsData sólo dentro del sandbox.

## Requisitos

- OpenClaw con soporte para plugins.
- Node.js 20 o posterior.
- Agy instalado y autenticado para el usuario que ejecuta OpenClaw.
- Bubblewrap (`bwrap`) disponible en `PATH`.
- Un entorno Linux con user namespaces habilitados.

Verificaciones rápidas:

```bash
agy models
bwrap --version
node --version
```

## Instalación

Cloná el repositorio en la ubicación elegida para las extensiones de OpenClaw:

```bash
git clone https://github.com/estebangesto/openclaw-agy-plugin.git
cd openclaw-agy-plugin
npm run check
```

Registrá la extensión en OpenClaw según el mecanismo de instalación de plugins de tu versión. El punto de entrada es `index.js` y el manifiesto es `openclaw.plugin.json`.

El plugin crea automáticamente sus directorios de estado, jobs y perfil. El perfil aislado debe contener la configuración de Agy necesaria para autenticarse; nunca subas ese contenido al repositorio.

## Configuración

Todas las propiedades son opcionales. Los valores de rutas se derivan de `OPENCLAW_STATE_DIR` y de `PATH` cuando no se especifican.

| Propiedad | Uso |
|---|---|
| `stateDir` | Directorio base de estado de OpenClaw. |
| `jobsRoot` | Directorio de estados y resultados de jobs. |
| `profileDir` | Perfil aislado con `profile-home`, `xdg-config`, `xdg-cache` y `xdg-data`. |
| `agyPath` | Ejecutable de Agy; también se puede usar `AGY_BIN`. |
| `bubblewrapPath` | Ejecutable `bwrap`. |
| `openclawPath` | Ejecutable utilizado para entregar resultados. |
| `defaultModel` | Modelo preferido; se valida contra `agy models`. También acepta `AGY_DEFAULT_MODEL`. |
| `modelCatalogTtlSeconds` | TTL del catálogo en memoria; por defecto, 3600 segundos. |
| `catalogRefreshTimeoutMs` | Tiempo máximo de actualización del catálogo; por defecto, 10000 ms. |
| `jobTimeoutSeconds` | Tiempo de espera predeterminado del job; por defecto, 300 segundos. |
| `tavilyApiKey` / `newsdataApiKey` | Credenciales opcionales, disponibles sólo dentro del sandbox. |

El catálogo se actualiza al iniciar el primer job y vuelve a consultarse cuando vence el TTL. Si una actualización posterior falla, se utiliza el último catálogo válido y la respuesta informa que está vencido. Si nunca hubo una actualización exitosa, el job se rechaza.

## Herramientas

### `extension_agy_submit`

Inicia un job asincrónico con `prompt`, `model` opcional y `timeoutSeconds` opcional. El modelo se valida contra el catálogo actual, por lo que no hay una lista fija que mantener en el código.

### `extension_agy_status`

Consulta el estado y el resultado de un job mediante su identificador UUID.

## Seguridad

El sandbox:

- elimina las capacidades Linux;
- separa PID y usuario;
- limita el acceso del proceso al perfil y al directorio de trabajo;
- limpia el entorno y expone únicamente las variables necesarias;
- impide leer o modificar el workspace del host desde el prompt de investigación.

Revisá la configuración de user namespaces y las políticas de tu distribución antes de usarlo en producción.

## Desarrollo

```bash
npm run check
```

La guía de contribución está en [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licencia

MIT. Ver [`LICENSE`](LICENSE).
