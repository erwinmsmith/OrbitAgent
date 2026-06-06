# OrbitAgent Web

React + Vite frontend for OrbitAgent, using `@assistant-ui/react` for the chat runtime and primitives.

## Development

```bash
npm install
npm run dev
```

From the repository root:

```bash
npm run web:dev
```

The frontend defaults to same-origin API calls:

```text
/api/v1
```

During local development, Vite proxies `/api/*` to `http://127.0.0.1:3000`.
Override the API origin only when the frontend and backend are on different
domains:

```bash
VITE_ORBIT_API_BASE=http://localhost:3000/api/v1 npm run dev
```

## Build

```bash
npm run build
```

From the repository root:

```bash
npm run web:build
```
