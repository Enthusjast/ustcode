import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { UnauthorizedError } from "../errors.js"

export class Authorization extends HttpApiMiddleware.Service<Authorization>()("@ustcode-ai/HttpApiAuthorization", {
  error: UnauthorizedError,
}) {}
