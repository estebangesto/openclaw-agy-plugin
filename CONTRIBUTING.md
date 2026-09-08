# Contribuir

Gracias por contribuir a OpenClaw Agy Plugin.

## Alcance

El proyecto busca ofrecer una integración portable y segura entre OpenClaw, Agy y Bubblewrap. Los cambios deben preservar el aislamiento, evitar rutas personales y mantener actualizable el catálogo de modelos.

## Flujo

1. Abrí una issue para cambios funcionales, problemas de seguridad o decisiones de diseño relevantes.
2. Creá una rama `feature/<resumen>` o `fix/<resumen>` desde `main`.
3. Implementá un cambio acotado y documentá su impacto.
4. Ejecutá `npm run check` y las verificaciones adicionales pertinentes.
5. Abrí un Pull Request hacia `main` con descripción, pruebas, riesgos y referencias.

La integración requiere revisión y checks exitosos. No se deben incluir credenciales, perfiles de Agy, resultados de jobs ni archivos de estado.

## Convenciones

- Código y documentación pública en español, salvo nombres técnicos o APIs.
- Commits con Conventional Commits y descripción en español, por ejemplo: `feat: actualizar catálogo dinámico de modelos`.
- Mantener compatibilidad con Node.js 20 o posterior.
- No agregar dependencias sin justificar su necesidad y su impacto de seguridad.
- Preferir configuración explícita y portable a rutas hardcodeadas.

## Pruebas mínimas

```bash
npm run check
```

Para cambios en el catálogo o el sandbox, probá además en un entorno Linux con `agy models` y `bwrap` disponibles. Documentá los comandos ejecutados en el Pull Request.

## Reportes de seguridad

No publiques vulnerabilidades o credenciales en issues. Informá el problema al responsable del repositorio mediante el canal privado disponible en GitHub.

## Licencia

Al contribuir aceptás que tu aporte se distribuya bajo la licencia MIT del proyecto.
