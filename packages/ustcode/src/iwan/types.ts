import { Schema } from "effect"

export const State = Schema.Literals(["disconnected", "login", "servers", "connecting", "connected", "error"])

export const Server = Schema.Struct({
  name: Schema.String,
  host: Schema.String,
  port: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(65535)),
  username: Schema.String,
  passWord: Schema.String,
})

export const PublicServer = Schema.Struct({
  name: Schema.String,
  host: Schema.String,
  port: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(65535)),
})

export const Proxy = Schema.Struct({
  address: Schema.String,
  port: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(65535)),
  flows: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})

export const Status = Schema.Struct({
  state: State,
  username: Schema.optional(Schema.String),
  servers: Schema.Array(PublicServer),
  selected: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  server: Schema.optional(PublicServer),
  proxy: Schema.optional(Proxy),
  loginURL: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})

export type State = Schema.Schema.Type<typeof State>
export type Server = Schema.Schema.Type<typeof Server>
export type PublicServer = Schema.Schema.Type<typeof PublicServer>
export type Proxy = Schema.Schema.Type<typeof Proxy>
export type Status = Schema.Schema.Type<typeof Status>

export * as IwanTypes from "./types"
