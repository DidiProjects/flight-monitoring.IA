# Agente: flight.FRONT

Você é um agente especializado no projeto **flight.FRONT**, localizado em `C:\Users\diego\Documents\projects\flight.FRONT`.

## Stack

- **Runtime/Build:** Node.js 20+ + Vite 6.3.4
- **Framework:** React 19.1.0
- **Linguagem:** TypeScript 5.8.3 (strict mode)
- **UI:** Material UI 6.4.7 + Emotion
- **Roteamento:** React Router 7.5.1
- **Validação:** Zod 4.3.6
- **Toasts:** notistack 3.0.1
- **Date picker:** react-day-picker 9.14.0
- **Testes:** Vitest 3.1.2 + Testing Library
- **Deploy:** Netlify

## Estrutura de pastas

```
src/
├── components/
│   ├── atoms/          # Logo, Spinner, ActiveBadge, StatusChip
│   ├── molecules/      # RoutineCard, FormField, DateRangePickerField, ConfirmDialog, EmptyState, AdminNav
│   ├── organisms/      # RoutineForm, UserTable, AppHeader, etc.
│   └── templates/      # AppLayout, AuthLayout
├── pages/              # Login, Register, Dashboard, Admin, AdminAirlines, AdminUserRoutines,
│                       # ForgotPassword, ResetPassword, ChangePassword, Unsubscribe
├── services/           # ApiService (base), AuthService, RoutinesService, AirlinesService, UsersService
├── contexts/           # AuthContext + AuthProvider
├── hooks/              # useAuth, useToast, custom hooks
├── providers/          # AppProviders (composição de providers)
├── routes/             # index, ProtectedRoute, AdminRoute
├── types/              # auth.ts, routines.ts, airlines.ts, users.ts
├── utils/              # tokenStore, storage, toastEmitter, jwt, schemas
├── theme/              # Paleta MUI, tipografia, overrides de componentes
├── constants/          # Constantes da aplicação
└── test/               # setup.ts para Vitest
```

## Padrões de código

**Atomic Design:** `atoms → molecules → organisms → templates` — respeitar esta hierarquia ao criar componentes.

**Path aliases:** usar imports limpos via aliases configurados no Vite (ex: `@services`, `@atomic-components`). Não usar caminhos relativos longos.

**API Layer:** `ApiService` é a classe base com `get<T>()`, `post<T>()`, `patch<T>()`, `delete<T>()`. Serviços específicos herdam dela. Dados da API em `snake_case`, frontend em `camelCase` (conversão em `fromApi()`).

**Estilos:** MUI `sx` prop para estilos inline; `.style.ts` para estilos reutilizáveis. Theme centralizado em `src/theme/`.

**TypeScript strict:** tipos sempre explícitos; sem `any`; Zod para validação de formulários.

## Convenções críticas

- **Access Token:** armazenado **em memória** (limpa no reload) — nunca em localStorage
- **Refresh Token:** armazenado em `localStorage` com chave `flight_rt`
- **Refresh automático:**
  - **Reativo:** qualquer 401 dispara `ApiService.queuedRefresh()` — uma única chamada, requests pendentes ficam em fila
  - **Proativo:** `AuthContext` decodifica o `exp` do JWT e agenda refresh ~60s antes de expirar
- **Logout event-driven:** `window.dispatchEvent(new CustomEvent('auth:logout'))`
- **Toasts:** via `toastEmitter.error(message)` — nunca chamar notistack diretamente fora do `useToastListener`
- **Roles:** `'user' | 'admin'` (via `decodeJwtPayload()`)

## Rotar localmente

```bash
npm install
# .env ou .env.local:
# VITE_API_URL=http://localhost:3011/flight
# VITE_APP_URL=http://localhost:3000

npm start           # dev server → http://localhost:3000
npm run build       # typecheck + build de produção
npm run preview     # preview do build
npm run lint        # ESLint
npm test            # Vitest watch
npm run test:run    # Vitest single run
npm run test:coverage
```

## Integração com flight.API

**Base URL:** `import.meta.env.VITE_API_URL` (ex: `http://localhost:3011/flight`)

**Endpoints principais:**
- `/auth/login`, `/auth/logout`, `/auth/refresh`
- `/auth/forgot-password`, `/auth/reset-password/:token`, `/auth/change-password`
- `/routines` (GET/POST/PATCH/DELETE)
- `/routines/:id/activate`, `/routines/:id/deactivate`, `/routines/:id/dispatch`
- `/routines/admin/users/:userId` (admin)
- `/airlines` (GET), `/airlines/admin` (admin GET)
- `/airlines` (POST), `/airlines/:code/*` (admin PATCH/DELETE)

**Headers obrigatórios:** `Authorization: Bearer <accessToken>` em todas as rotas autenticadas.

## Rotas da aplicação

**Públicas:** `/login`, `/register`, `/forgot-password`, `/reset-password`, `/unsubscribe`

**Autenticadas (ProtectedRoute):** `/dashboard`, `/change-password`

**Admin-only (AdminRoute):** `/admin`, `/admin/airlines`, `/admin/user-routines`

**Fallback:** `/` → redirect para `/dashboard`
