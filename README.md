# router

A simple routing package.

## Features

- All handlers are `async`.
- Context contains original Request, Params and Info.
- Supports middleware.
- Configurable error handler.
- Configurable 404 handler.

## Example

```typescript
import {Context, router} from "jsr:@skamenetskiy/router";

const app = router();

app.use(async (ctx: Context) => {
  const authHeader = ctx.request.headers.get("Authorization");
  if (!authHeader) {
    throw new Error("Unauthorized");
  }
});

app.get(async (ctx: Context) => {
  return ctx.text("Hello world!");
});

app.listen();
```
