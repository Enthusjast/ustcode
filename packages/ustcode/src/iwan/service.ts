import { randomBytes } from "node:crypto"
import http from "node:http"
import https from "node:https"
import path from "node:path"
import { Readable } from "node:stream"
import { LayerNode } from "@enthusjast/ustcode-core/effect/layer-node"
import { Global } from "@enthusjast/ustcode-core/global"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { FSUtil } from "@enthusjast/ustcode-core/fs-util"
import {
  APP_SECRET,
  AUTH_URL,
  CLIENT_ID,
  CONTROLLER,
  CONTROLLER_APP_ID,
  DOMAIN,
  REDIRECT_URI,
  SCOPE,
  TOKEN_URL,
  aesGcmDecrypt,
  base64Url,
  base64UrlDecode,
  buildOpen,
  encryptPassword,
  hmacSha256,
  hex,
  parseOpenAck,
  randomHex,
  sha256,
} from "./protocol"
import { Socks } from "./socks"
import { connectUdp, type UdpChannel } from "./udp"
import { Server, type Server as ServerInfo, type Status as StatusInfo } from "./types"
import type { Agent } from "node:http"

const CONFIG_PATH = path.join(Global.Path.data, "iwan.json")
const ENCRYPTION = 1
const MTU = 1400
const AUTH_TIMEOUT = 3000

const Stored = Schema.Struct({
  accessToken: Schema.String,
  username: Schema.String,
  servers: Schema.Array(Server),
  selected: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
})
type Stored = Schema.Schema.Type<typeof Stored>

const Claims = Schema.Struct({
  name: Schema.optional(Schema.String),
  preferred_username: Schema.optional(Schema.String),
  sub: Schema.optional(Schema.String),
})

export class IwanError extends Schema.TaggedErrorClass<IwanError>()("IwanError", {
  message: Schema.String,
}) {}

type PendingLogin = {
  state: string
  verifier: string
  url: string
}

type ActiveTunnel = {
  socks: Socks
  server: ServerInfo
  index: number
}

export interface Interface {
  readonly status: () => Effect.Effect<StatusInfo>
  readonly beginLogin: () => Effect.Effect<StatusInfo, IwanError>
  readonly completeLogin: (redirect: string) => Effect.Effect<StatusInfo, IwanError>
  readonly connect: (index: number) => Effect.Effect<StatusInfo, IwanError>
  readonly stop: () => Effect.Effect<StatusInfo>
  readonly port: () => number | undefined
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  readonly routeFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

export class Service extends Context.Service<Service, Interface>()("@ustcode/Iwan") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const stored = yield* fs.readJson(CONFIG_PATH).pipe(
      Effect.map((value) => Option.getOrUndefined(Schema.decodeUnknownOption(Stored)(value))),
      Effect.catch(() => Effect.succeed(undefined)),
    )
    let config = stored
    let pending: PendingLogin | undefined
    let active: ActiveTunnel | undefined
    let state: StatusInfo["state"] = config?.servers.length ? "servers" : "disconnected"
    let errorMessage: string | undefined
    let proxyAgent: Agent | undefined
    let proxyPort: number | undefined

    const save = Effect.fn("Iwan.save")(function* (value: Stored) {
      yield* fs.writeWithDirs(CONFIG_PATH, JSON.stringify(value, null, 2), 0o600)
    })

    const status = Effect.fn("Iwan.status")(() => Effect.sync(makeStatus))

    const beginLogin = Effect.fn("Iwan.beginLogin")(() =>
      Effect.try({
        try: () => {
          if (config?.servers.length) {
            state = "servers"
            errorMessage = undefined
            return makeStatus()
          }
          const verifier = base64Url(randomBytes(64))
          const challenge = base64Url(sha256(verifier))
          const oauthState = randomAlphaNumeric(32)
          const params = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            scope: SCOPE,
            code_challenge: challenge,
            code_challenge_method: "S256",
            state: oauthState,
          })
          pending = { state: oauthState, verifier, url: `${AUTH_URL}?${params}` }
          state = "login"
          errorMessage = undefined
          return makeStatus()
        },
        catch: (cause) => toIwanError(cause),
      }),
    )

    const completeLogin = Effect.fn("Iwan.completeLogin")(function* (redirect: string) {
      const login = pending
      if (!login) return yield* Effect.fail(new IwanError({ message: "iWAN login has not been started" }))
      const result = yield* Effect.tryPromise({
        try: async () => {
          const url = new URL(redirect.trim())
          const params = url.searchParams
          const returnedState = params.get("state")
          if (returnedState !== login.state) throw new Error("iWAN OAuth state mismatch")
          const oauthError = params.get("error")
          if (oauthError) throw new Error(params.get("error_description") ?? oauthError)
          const code = params.get("code")
          if (!code) throw new Error("iWAN redirect URL does not contain an authorization code")
          const token = await exchangeToken(code, login.verifier)
          const username = token.username
          const servers = await fetchServers(token.accessToken, username)
          if (servers.length === 0) throw new Error("iWAN controller returned no available servers")
          return { accessToken: token.accessToken, username, servers, selected: 0 } satisfies Stored
        },
        catch: (cause) => toIwanError(cause),
      })
      config = { ...result }
      pending = undefined
      state = "servers"
      errorMessage = undefined
      yield* save(result).pipe(Effect.mapError(toIwanError))
      return makeStatus()
    })

    const connect = Effect.fn("Iwan.connect")(function* (index: number) {
      const current = config
      if (!current) return yield* Effect.fail(new IwanError({ message: "iWAN login is required first" }))
      const server = current.servers[index]
      if (!server) return yield* Effect.fail(new IwanError({ message: "iWAN server selection is invalid" }))
      state = "connecting"
      errorMessage = undefined
      yield* Effect.tryPromise({
        try: async () => {
          await stopActive()
          const password = decryptServerPassword(server)
          const authenticated = await authenticate(server, password)
          let opened: Socks | undefined
          opened = await Socks.open({
            udp: authenticated.udp,
            auth: authenticated.auth,
            username: server.username,
            password,
            encryption: ENCRYPTION,
            onError: (cause) => {
              if (opened && active?.socks === opened) {
                active = undefined
                proxyPort = undefined
                state = "error"
                errorMessage = cause.message
              }
            },
          })
          active = { socks: opened, server, index }
          proxyPort = opened.status().port
          config = { ...current, selected: index }
          await saveCurrent()
        },
        catch: (cause) => toIwanError(cause),
      }).pipe(
        Effect.tapError((cause) =>
          Effect.sync(() => {
            state = "error"
            errorMessage = cause.message
          }),
        ),
      )
      state = "connected"
      return makeStatus()
    })

    const stop = Effect.fn("Iwan.stop")(function* () {
      yield* Effect.promise(stopActive)
      pending = undefined
      state = config?.servers.length ? "servers" : "disconnected"
      errorMessage = undefined
      return makeStatus()
    })

    const port = () => proxyPort

    const routedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const port = proxyPort
      if (!active || port === undefined) throw new Error("iWAN tunnel is not connected; run /iwan first")
      if (!proxyAgent) {
        const { SocksProxyAgent } = await import("socks-proxy-agent")
        proxyAgent = new SocksProxyAgent(`socks5h://127.0.0.1:${port}`)
      }
      return requestViaSocks(input, init, proxyAgent)
    }

    const routeFetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isUstcApiUrl(input)) return globalThis.fetch(input, init)
      return routedFetch(input, init)
    }

    function makeStatus(): StatusInfo {
      const current = active
      return {
        state,
        username: config?.username,
        servers: config?.servers.map(publicServer) ?? [],
        selected: config?.selected,
        server: current ? publicServer(current.server) : undefined,
        proxy: current ? current.socks.status() : undefined,
        loginURL: pending?.url,
        error: errorMessage,
      }
    }

    async function saveCurrent() {
      if (!config) return
      await fs.writeWithDirs(CONFIG_PATH, JSON.stringify(config, null, 2), 0o600).pipe(Effect.runPromise)
    }

    async function stopActive() {
      active?.socks.stop()
      active = undefined
      proxyPort = undefined
      proxyAgent?.destroy()
      proxyAgent = undefined
    }

    yield* Effect.addFinalizer(() => Effect.promise(stopActive).pipe(Effect.ignore))
    return Service.of({
      status,
      beginLogin: () => beginLogin(),
      completeLogin: (redirect) => completeLogin(redirect).pipe(Effect.mapError(toIwanError)),
      connect,
      stop,
      port,
      fetch: routedFetch,
      routeFetch,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })

function isUstcApiUrl(input: RequestInfo | URL) {
  const url = new URL(input instanceof Request ? input.url : input)
  return url.hostname === "api.llm.ustc.edu.cn"
}

async function requestViaSocks(input: RequestInfo | URL, init: RequestInit | undefined, agent: Agent) {
  const source = input instanceof Request ? input : undefined
  const url = new URL(input instanceof Request ? input.url : input)
  const method = (init?.method ?? source?.method ?? "GET").toUpperCase()
  const headers = new Headers(source?.headers)
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
  const body =
    init?.body ?? (source && method !== "GET" && method !== "HEAD" ? await source.clone().arrayBuffer() : undefined)
  const bodyBytes = body === undefined || body === null ? undefined : await bodyBuffer(body)
  const requestHeaders: Record<string, string> = {}
  headers.forEach((value, key) => {
    requestHeaders[key] = value
  })

  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers: requestHeaders,
        agent,
      },
      (response) => {
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (value === undefined) continue
          responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value)
        }
        resolve(
          new Response(Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>, {
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: responseHeaders,
          }),
        )
      },
    )
    const signal = init?.signal ?? source?.signal
    const abort = () => request.destroy(new Error("iWAN request aborted"))
    if (signal?.aborted) {
      abort()
      reject(new Error("iWAN request aborted"))
      return
    }
    signal?.addEventListener("abort", abort, { once: true })
    request.once("error", reject)
    request.once("close", () => signal?.removeEventListener("abort", abort))
    if (bodyBytes) request.write(bodyBytes)
    request.end()
  })
}

async function bodyBuffer(body: BodyInit | ArrayBuffer) {
  if (typeof body === "string") return Buffer.from(body)
  if (body instanceof URLSearchParams) return Buffer.from(body.toString())
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer())
  return Buffer.from(await new Response(body).arrayBuffer())
}

function publicServer(server: ServerInfo) {
  return {
    name: server.name,
    host: server.host,
    port: server.port,
  }
}

function toIwanError(cause: unknown) {
  return new IwanError({ message: cause instanceof Error ? cause.message : String(cause) })
}

function randomAlphaNumeric(length: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = randomBytes(length)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

async function exchangeToken(code: string, verifier: string) {
  const body = await postJson(TOKEN_URL, {
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  })
  const accessToken = recordValue(body, "access_token")
  if (typeof accessToken !== "string" || !accessToken) throw new Error("iWAN token response has no access_token")
  const idToken = recordValue(body, "id_token")
  const username = typeof idToken === "string" ? jwtUsername(idToken) : undefined
  return { accessToken, username: username ?? "unknown" }
}

async function fetchServers(accessToken: string, username: string) {
  const body = {
    domain: DOMAIN,
    type: "android",
    oem_name: "panabit",
    device_id: randomHex(8),
    userName: username,
    serverlist_version: "0",
    ipfilter_version: "0",
    branding_version: "0",
  }
  await controllerPost("/m/auth", body, accessToken)
  await controllerPost("/m/keepalive", { ...body, type: "keepalive" }, accessToken)
  const response = await controllerPost("/m/config", body, accessToken)
  const list = recordValue(recordValue(response, "serverlist"), "serverlist")
  if (!Array.isArray(list)) return []
  return list.flatMap((item): ServerInfo[] => {
    const value = record(item)
    if (!value) return []
    const name = value.name
    const host = value.serverName
    const port = value.serverPort
    const user = value.userName
    const passWord = value.passWord
    if (
      typeof name !== "string" ||
      typeof host !== "string" ||
      typeof user !== "string" ||
      typeof passWord !== "string"
    )
      return []
    const serverPort =
      port === undefined || port === null
        ? 6001
        : typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535
          ? port
          : undefined
    if (serverPort === undefined) return []
    return [{ name, host, port: serverPort, username: user, passWord }]
  })
}

async function controllerPost(endpoint: string, body: Record<string, unknown>, accessToken: string) {
  const text = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = randomHex(16).toUpperCase()
  const canonical = ["POST", endpoint, "", hex(sha256(text)), timestamp, nonce].join("\n")
  const signature = hex(hmacSha256(APP_SECRET, canonical))
  return postJson(`${CONTROLLER}${endpoint}`, body, {
    Authorization: `Bearer ${accessToken}`,
    "X-Auth-AppId": CONTROLLER_APP_ID,
    "X-Auth-Timestamp": timestamp,
    "X-Auth-Nonce": nonce,
    "X-Auth-Sign": signature,
  })
}

async function postJson(url: string, body: Record<string, unknown>, extraHeaders?: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const value = text ? (JSON.parse(text) as unknown) : undefined
  if (!response.ok) {
    const detail = typeof value === "string" ? value : JSON.stringify(value)
    throw new Error(`iWAN request failed (${response.status}): ${detail}`)
  }
  return value
}

function jwtUsername(idToken: string) {
  const encoded = idToken.split(".")[1]
  if (!encoded) return undefined
  const claims = Option.getOrUndefined(
    Schema.decodeUnknownOption(Claims)(JSON.parse(base64UrlDecode(encoded).toString("utf8"))),
  )
  return claims?.name ?? claims?.preferred_username ?? claims?.sub
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function recordValue(value: unknown, key: string) {
  return record(value)?.[key]
}

function decryptServerPassword(server: ServerInfo) {
  const key = sha256(`${APP_SECRET}|${DOMAIN}|${server.username}`)
  const encoded = base64UrlDecode(server.passWord)
  if (encoded.length < 28) throw new Error("iWAN server password is too short")
  return aesGcmDecrypt(
    key,
    encoded.subarray(0, 12),
    encoded.subarray(12),
    Buffer.from(`${DOMAIN}|${server.username}`),
  ).toString("utf8")
}

async function authenticate(server: ServerInfo, password: string) {
  const nonce = randomBytes(4).readUInt32BE(0)
  const udp = await connectUdp(server.host, server.port)
  try {
    const packet = buildOpen(server.username, encryptPassword(password, server.username), MTU, ENCRYPTION, nonce)
    let lastError: unknown = new Error("iWAN authentication timed out")
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = receive(udp)
      udp.socket.send(packet)
      try {
        return { udp, auth: parseOpenAck(await response, nonce) }
      } catch (cause) {
        lastError = cause
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    throw lastError
  } catch (cause) {
    udp.socket.close()
    throw cause
  }
}

function receive(udp: UdpChannel) {
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("iWAN authentication timed out")), AUTH_TIMEOUT)
    udp.setHandler({
      data(data) {
        clearTimeout(timer)
        resolve(data)
      },
      error(error) {
        clearTimeout(timer)
        reject(error)
      },
    })
  })
}

export * as Iwan from "./service"
