import { Iwan } from "@/iwan/service"
import { IwanTypes } from "@/iwan/types"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/iwan"

export const CompleteLoginPayload = Schema.Struct({ redirect: Schema.String })
export const ConnectPayload = Schema.Struct({ index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })

export class IwanApiError extends Schema.ErrorClass<IwanApiError>("IwanApiError")(
  {
    name: Schema.Literal("IwanError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}

export const IwanApi = HttpApi.make("iwan").add(
  HttpApiGroup.make("iwan")
    .add(
      HttpApiEndpoint.get("status", root, {
        query: WorkspaceRoutingQuery,
        success: described(IwanTypes.Status, "iWAN tunnel status"),
        error: IwanApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "iwan.status",
          summary: "Get iWAN status",
          description: "Get the USTC iWAN login, server selection, and tunnel status.",
        }),
      ),
      HttpApiEndpoint.post("login", `${root}/login`, {
        query: WorkspaceRoutingQuery,
        success: described(IwanTypes.Status, "iWAN login state"),
        error: IwanApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "iwan.login",
          summary: "Start iWAN login",
          description: "Start the USTC iWAN OIDC PKCE login flow.",
        }),
      ),
      HttpApiEndpoint.post("callback", `${root}/callback`, {
        query: WorkspaceRoutingQuery,
        payload: CompleteLoginPayload,
        success: described(IwanTypes.Status, "iWAN server list"),
        error: IwanApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "iwan.callback",
          summary: "Complete iWAN login",
          description: "Exchange the pasted OIDC redirect URL and retrieve iWAN servers.",
        }),
      ),
      HttpApiEndpoint.post("connect", `${root}/connect`, {
        query: WorkspaceRoutingQuery,
        payload: ConnectPayload,
        success: described(IwanTypes.Status, "iWAN tunnel status"),
        error: IwanApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "iwan.connect",
          summary: "Connect iWAN",
          description: "Connect the selected USTC iWAN server and start the local SOCKS tunnel.",
        }),
      ),
      HttpApiEndpoint.post("stop", `${root}/stop`, {
        query: WorkspaceRoutingQuery,
        success: described(IwanTypes.Status, "iWAN tunnel status"),
        error: IwanApiError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "iwan.stop",
          summary: "Stop iWAN",
          description: "Stop the USTC iWAN tunnel.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "iWAN", description: "USTC iWAN network tunnel routes." }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)

export * as Iwan from "./iwan"
