import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from "node:crypto"
import { request as httpsRequest } from "node:https"
import type { Server, ServerResponse } from "node:http"
import { Deferred, Effect } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@ustcode-ai/plugin/effect/integration"
import { Credential } from "../../../credential.js"
import { Integration } from "../../../integration.js"

export const PROVIDER_ID = "ustc-tokenworks"
export const METHOD_ID = Integration.MethodID.make("oidc")
export const CLIENT_ID = "claude"
export const ISSUER = "https://id.ustc.edu.cn/doc/oidc"
export const BOOTSTRAP_URL = "https://id.ustc.edu.cn/doc/claude/bootstrap"
export const SCOPES = ["openid", "profile", "email", "offline_access"] as const

export type Requester = (url: string, init?: RequestInit) => Promise<Response>
type Token = {
  access_token: string
  refresh_token?: string
  id_token?: string
  token_type: string
  expires_in: number
}
type Discovery = {
  authorizationEndpoint: string
  tokenEndpoint: string
  userInfoEndpoint: string
  jwksURI: string
  issuerParameter: boolean
}
type Claims = Record<string, unknown> & { sub: string }

const callbackHost = "127.0.0.1"
const requestTimeout = 10_000
const tokenFlight = new Map<string, Promise<Credential.OAuth>>()

export function method(requester: Requester = requestDirect): IntegrationOAuthMethodRegistration {
  return {
    integrationID: PROVIDER_ID,
    method: { id: METHOD_ID, type: "oauth", label: "Sign in with USTC TokenWorks" },
    authorize: () =>
      Effect.gen(function* () {
        const discovery = yield* Effect.tryPromise(() => discover(requester))
        const state = randomBytes(24).toString("base64url")
        const nonce = randomBytes(24).toString("base64url")
        const verifier = randomBytes(48).toString("base64url")
        const challenge = createHash("sha256").update(verifier).digest("base64url")
        const callback = yield* Deferred.make<{ code: string; issuer?: string }, Error>()
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        let redirectURI = ""
        let consumed = false
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", `http://${callbackHost}`)
          if (request.method !== "GET" || url.pathname !== "/callback") {
            response.writeHead(404).end()
            return
          }
          const fail = (message: string) => {
            response.writeHead(400, callbackHeaders).end("USTC TokenWorks sign-in failed. Return to USTCode and retry.")
            Effect.runFork(Deferred.fail(callback, new Error(message)))
          }
          if (request.headers.host !== new URL(redirectURI).host) {
            fail("OIDC callback host does not match")
            return
          }
          if (consumed || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state) {
            fail("OIDC callback state does not match")
            return
          }
          consumed = true
          const error = url.searchParams.get("error")
          if (error) {
            fail("USTC TokenWorks sign-in was denied")
            return
          }
          const codes = url.searchParams.getAll("code")
          if (codes.length !== 1 || !codes[0]) {
            fail("OIDC callback has no authorization code")
            return
          }
          const issuer = url.searchParams.get("iss") ?? undefined
          if ((discovery.issuerParameter || issuer !== undefined) && issuer !== ISSUER) {
            fail("OIDC callback issuer does not match")
            return
          }
          response
            .writeHead(200, callbackHeaders)
            .end("Authorization code received. Return to USTCode while it verifies your sign-in.")
          Effect.runFork(Deferred.succeed(callback, { code: codes[0], issuer }))
        })
        const port = yield* listen(server)
        redirectURI = `http://${callbackHost}:${port}/callback`
        server.unref()
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            server.close()
            server.closeAllConnections()
          }),
        )
        const url = new URL(discovery.authorizationEndpoint)
        url.searchParams.set("response_type", "code")
        url.searchParams.set("client_id", CLIENT_ID)
        url.searchParams.set("redirect_uri", redirectURI)
        url.searchParams.set("scope", SCOPES.join(" "))
        url.searchParams.set("state", state)
        url.searchParams.set("nonce", nonce)
        url.searchParams.set("code_challenge", challenge)
        url.searchParams.set("code_challenge_method", "S256")
        return {
          mode: "auto" as const,
          url: url.href,
          instructions: "Complete authorization in your browser. This window will close automatically.",
          callback: Deferred.await(callback).pipe(
            Effect.flatMap(({ code }) =>
              Effect.tryPromise(() =>
                exchange(requester, discovery, {
                  grant_type: "authorization_code",
                  code,
                  redirect_uri: redirectURI,
                  code_verifier: verifier,
                }),
              ),
            ),
            Effect.flatMap((tokens) =>
              Effect.tryPromise({
                try: async () => {
                  if (!tokens.id_token) throw new Error("OIDC token response has no ID token")
                  const claims = await verifyIDToken(requester, discovery, tokens.id_token, nonce, tokens.access_token)
                  const user = await getUserInfo(requester, discovery, tokens.access_token)
                  if (user.sub !== claims.sub) throw new Error("OIDC UserInfo subject does not match the ID token")
                  return credential(tokens, {
                    ...claims,
                    name: displayName(user) ?? displayName(claims) ?? claims.sub,
                  })
                },
                catch: (cause) => cause,
              }),
            ),
          ),
        }
      }),
    refresh: (value) => refresh(requester, value),
    label: (value) => (typeof value.metadata?.name === "string" ? value.metadata.name : undefined),
  }
}

async function discover(requester: Requester): Promise<Discovery> {
  const metadata = await json(requester, `${ISSUER}/.well-known/openid-configuration`)
  if (metadata.issuer !== ISSUER) throw new Error("OIDC discovery issuer does not match")
  if (
    !Array.isArray(metadata.code_challenge_methods_supported) ||
    !metadata.code_challenge_methods_supported.includes("S256")
  ) {
    throw new Error("USTC OIDC issuer does not support PKCE S256")
  }
  return {
    authorizationEndpoint: sameOrigin(metadata.authorization_endpoint),
    tokenEndpoint: sameOrigin(metadata.token_endpoint),
    userInfoEndpoint: sameOrigin(metadata.userinfo_endpoint),
    jwksURI: sameOrigin(metadata.jwks_uri),
    issuerParameter: metadata.authorization_response_iss_parameter_supported === true,
  }
}

function refresh(requester: Requester, value: Credential.OAuth) {
  const current = tokenFlight.get(value.refresh)
  if (current) return Effect.tryPromise(() => current)
  const operation = Effect.runPromise(
    Effect.gen(function* () {
      const discovery = yield* Effect.tryPromise(() => discover(requester))
      const tokens = yield* Effect.tryPromise(() =>
        exchange(requester, discovery, { grant_type: "refresh_token", refresh_token: value.refresh }),
      )
      return yield* Effect.tryPromise(async () => {
        const oldSubject = typeof value.metadata?.sub === "string" ? value.metadata.sub : undefined
        if (!oldSubject) throw new Error("Stored USTC TokenWorks account has no subject")
        const claims = tokens.id_token
          ? await verifyIDToken(requester, discovery, tokens.id_token, undefined, tokens.access_token)
          : { sub: oldSubject }
        if (claims.sub !== oldSubject) throw new Error("OIDC refreshed account does not match")
        return credential(
          tokens,
          {
            ...value.metadata,
            ...claims,
            name: typeof value.metadata?.name === "string" ? value.metadata.name : (displayName(claims) ?? oldSubject),
          },
          value.refresh,
        )
      })
    }),
  )
  tokenFlight.set(value.refresh, operation)
  return Effect.tryPromise(() => operation).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (tokenFlight.get(value.refresh) === operation) tokenFlight.delete(value.refresh)
      }),
    ),
  )
}

async function exchange(requester: Requester, discovery: Discovery, fields: Record<string, string>): Promise<Token> {
  const result = await json(requester, discovery.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }).toString(),
  })
  if (result.error === "invalid_grant") throw new Error("USTC TokenWorks sign-in expired; sign in again")
  if (typeof result.access_token !== "string" || result.access_token.length === 0)
    throw new Error("OIDC token response has no access token")
  if (typeof result.token_type !== "string" || result.token_type.toLowerCase() !== "bearer")
    throw new Error("OIDC token response must use Bearer tokens")
  if (typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0)
    throw new Error("OIDC token response has an invalid lifetime")
  if (result.refresh_token !== undefined && (typeof result.refresh_token !== "string" || !result.refresh_token))
    throw new Error("OIDC token response has an invalid refresh token")
  return result as Token
}

async function verifyIDToken(
  requester: Requester,
  discovery: Discovery,
  token: string,
  nonce?: string,
  accessToken?: string,
): Promise<Claims> {
  const [headerPart, payloadPart, signature, extra] = token.split(".")
  if (!headerPart || !payloadPart || !signature || extra !== undefined) throw new Error("OIDC ID token is malformed")
  const header = parsePart(headerPart)
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0)
    throw new Error("OIDC ID token signing algorithm is unsupported")
  const jwks = await json(requester, discovery.jwksURI)
  if (!Array.isArray(jwks.keys)) throw new Error("OIDC JWKS has no keys")
  const keys = jwks.keys.filter(
    (value) =>
      isRecord(value) &&
      value.kty === "RSA" &&
      value.kid === header.kid &&
      (value.use === undefined || value.use === "sig") &&
      (value.alg === undefined || value.alg === "RS256"),
  )
  if (keys.length !== 1) throw new Error("OIDC ID token signing key is not unique")
  const key = createPublicKey({ key: keys[0] as JsonWebKey, format: "jwk" })
  if (!verify("RSA-SHA256", Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signature, "base64url")))
    throw new Error("OIDC ID token signature does not match")
  const claims = parsePart(payloadPart) as Claims
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  const now = Date.now() / 1_000
  if (
    claims.iss !== ISSUER ||
    !audience.includes(CLIENT_ID) ||
    (audience.length > 1 && claims.azp !== CLIENT_ID) ||
    (claims.azp !== undefined && claims.azp !== CLIENT_ID) ||
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    typeof claims.exp !== "number" ||
    claims.exp < now - 60 ||
    typeof claims.iat !== "number" ||
    claims.iat > now + 60 ||
    (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now + 60)) ||
    (nonce !== undefined && claims.nonce !== nonce)
  ) {
    throw new Error("OIDC ID token claims do not match")
  }
  if (claims.at_hash !== undefined) {
    if (
      !accessToken ||
      claims.at_hash !== createHash("sha256").update(accessToken).digest().subarray(0, 16).toString("base64url")
    )
      throw new Error("OIDC access-token hash does not match")
  }
  return claims
}

async function getUserInfo(requester: Requester, discovery: Discovery, accessToken: string) {
  const user = await json(requester, discovery.userInfoEndpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (typeof user.sub !== "string" || user.sub.length === 0) throw new Error("OIDC UserInfo has no subject")
  return user as Record<string, unknown> & { sub: string }
}

function credential(tokens: Token, metadata: Record<string, unknown>, previousRefresh?: string): Credential.OAuth {
  const refreshToken = tokens.refresh_token ?? previousRefresh
  if (!refreshToken) throw new Error("OIDC token response has no refresh token")
  return Credential.OAuth.make({
    type: "oauth",
    methodID: METHOD_ID,
    access: tokens.access_token,
    refresh: refreshToken,
    expires: Math.trunc(Date.now() + tokens.expires_in * 1_000),
    metadata: {
      ...metadata,
      issuer: ISSUER,
      clientId: CLIENT_ID,
    },
  })
}

function displayName(value: Record<string, unknown>) {
  return [value.name, value.preferred_username, value.email].find(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  )
}

function sameOrigin(input: unknown) {
  if (typeof input !== "string") throw new Error("OIDC discovery is missing a required endpoint")
  const url = new URL(input)
  if (url.origin !== new URL(ISSUER).origin || url.username || url.password || url.hash)
    throw new Error("OIDC discovery endpoint has an unexpected origin")
  return url.href
}

async function json(requester: Requester, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await requester(url, init)
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("USTC identity response is too large")
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error("USTC identity service returned invalid JSON")
  }
  if (!isRecord(value)) throw new Error(`USTC identity service answered HTTP ${response.status}`)
  if (!response.ok) {
    if (value.error === "invalid_grant") throw new Error("USTC TokenWorks sign-in expired; sign in again")
    throw new Error(`USTC identity service answered HTTP ${response.status}`)
  }
  return value
}

function parsePart(value: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    throw new Error("OIDC ID token JSON is malformed")
  }
  if (!isRecord(parsed)) throw new Error("OIDC ID token JSON is malformed")
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function listen(server: Server): Effect.Effect<number, Error> {
  return Effect.callback((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error))
    server.once("error", onError)
    server.listen(0, callbackHost, () => {
      server.off("error", onError)
      const address = server.address()
      if (address && typeof address === "object") resume(Effect.succeed(address.port))
      else resume(Effect.fail(new Error("Could not start the USTC OIDC callback listener")))
    })
  })
}

const callbackHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
}

export const requestDirect: Requester = (url, init) =>
  new Promise((resolve, reject) => {
    const body = typeof init?.body === "string" ? Buffer.from(init.body) : undefined
    if (init?.body !== undefined && body === undefined) {
      reject(new TypeError("USTC OIDC requests only support string bodies"))
      return
    }
    const headers = Object.fromEntries(new Headers(init?.headers))
    if (body && headers["content-length"] === undefined) headers["content-length"] = String(body.byteLength)
    if (headers.accept === undefined) headers.accept = "application/json"
    const signal = init?.signal
    const request = httpsRequest(
      url,
      { method: init?.method ?? "GET", agent: false, headers },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += bytes.length
          if (size > 4 * 1024 * 1024) {
            request.destroy(new Error("USTC identity response is too large"))
            return
          }
          chunks.push(bytes)
        })
        response.once("error", () => reject(new Error("USTC identity response was interrupted")))
        response.once("end", () => {
          const responseHeaders = Object.fromEntries(
            Object.entries(response.headers).flatMap(([name, value]) =>
              value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]],
            ),
          )
          resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 0, headers: responseHeaders }))
        })
      },
    )
    const abort = () => request.destroy(new Error("USTC identity request was aborted"))
    if (signal?.aborted) abort()
    else signal?.addEventListener("abort", abort, { once: true })
    request.setTimeout(requestTimeout, () => request.destroy(new Error("USTC identity request timed out")))
    request.once("close", () => signal?.removeEventListener("abort", abort))
    request.once("error", reject)
    request.end(body)
  })
