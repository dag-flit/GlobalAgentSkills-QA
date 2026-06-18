# packs/dev-side — packs opcionales del lado desarrollo (NO se instalan por defecto)

`dev-tester` (generación de tests unitarios + evidencias por AC) vive aquí.
Se retiró del core QA por estar acoplado a un stack concreto (.NET/Vitest) y por ser
flujo de desarrollo, no de QA. La capa unit del flujo QA la cubre `core/skills/unit-test-runner`
(solo ejecuta y resume specs existentes). Globalizar dev-tester (language packs dotnet/node/python)
queda como trabajo opcional posterior.
