import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { CLIENT_ID, ISSUER, method } from "../../src/plugin/provider/tokenworks/oidc"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "ustc-test-key",
  use: "sig",
  alg: "RS256",
}

function signedToken(input: { nonce: string; audience?: string | string[] }) {
  const accessToken = "oidc-access"
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "ustc-test-key" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      aud: input.audience ?? CLIENT_ID,
      sub: "ustc-user-1",
      name: "USTC User",
      nonce: input.nonce,
      exp: Math.floor(Date.now() / 1_000) + 3600,
      iat: Math.floor(Date.now() / 1_000),
      at_hash: createHash("sha256").update(accessToken).digest().subarray(0, 16).toString("base64url"),
    }),
  ).toString("base64url")
  const signature = sign("RSA-SHA256", Buffer.from(header + "." + payload), privateKey).toString("base64url")
  return { token: header + "." + payload + "." + signature, accessToken }
}

function requester(input: { nonce?: string; audience?: string | string[] }) {
  const requests: { url: string; init?: RequestInit }[] = []
  let nonce = input.nonce ?? ""
  const send = async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    if (url === ISSUER + "/.well-known/openid-configuration")
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: ISSUER + "/authorize",
        token_endpoint: ISSUER + "/token",
        userinfo_endpoint: ISSUER + "/userinfo",
        jwks_uri: ISSUER + "/jwks",
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
      })
    if (url === ISSUER + "/jwks") return Response.json({ keys: [jwk] })
    if (url === ISSUER + "/userinfo") return Response.json({ sub: "ustc-user-1", name: "USTC User" })
    if (url === ISSUER + "/token") {
      const token = signedToken({ nonce, audience: input.audience })
      return Response.json({
        access_token: token.accessToken,
        refresh_token: "oidc-refresh",
        id_token: token.token,
        token_type: "Bearer",
        expires_in: 3600,
      })
    }
    throw new Error("Unexpected OIDC request: " + url)
  }
  return { requests, send, setNonce: (value: string) => (nonce = value) }
}

describe("USTC TokenWorks OIDC", () => {
  it.live("uses Client ID claude, PKCE, a one-time loopback callback, and verified UserInfo", () =>
    Effect.gen(function* () {
      const fixture = requester({})
      const registration = method(fixture.send)
      const authorization = yield* registration.authorize({})
      if (authorization.mode !== "auto") throw new Error("Expected loopback OAuth")
      const url = new URL(authorization.url)
      const nonce = url.searchParams.get("nonce")!
      fixture.setNonce(nonce)
      expect(url.searchParams.get("client_id")).toBe("claude")
      expect(url.searchParams.get("scope")).toBe("openid profile email offline_access")
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("code_challenge")).toBeTruthy()
      const callback = new URL(url.searchParams.get("redirect_uri")!)
      expect(callback.hostname).toBe("127.0.0.1")
      expect(callback.pathname).toBe("/callback")
      callback.search = new URLSearchParams({
        state: url.searchParams.get("state")!,
        iss: ISSUER,
        code: "one-time-code",
      }).toString()

      const pending = yield* authorization.callback.pipe(Effect.forkScoped)
      const browser = yield* Effect.tryPromise(() => fetch(callback, { headers: { Connection: "close" } }))
      const credential = yield* Fiber.join(pending)
      expect(browser.status).toBe(200)
      expect(credential).toMatchObject({
        type: "oauth",
        access: "oidc-access",
        refresh: "oidc-refresh",
        metadata: { sub: "ustc-user-1", name: "USTC User", clientId: "claude" },
      })
      const exchange = fixture.requests.find((item) => item.url === ISSUER + "/token")
      const body = new URLSearchParams(exchange?.init?.body as string)
      expect(body.get("grant_type")).toBe("authorization_code")
      expect(body.get("code")).toBe("one-time-code")
      expect(body.get("redirect_uri")).toBe(url.searchParams.get("redirect_uri"))
      expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(
        url.searchParams.get("code_challenge")!,
      )
      expect(fixture.requests.some((item) => item.url === ISSUER + "/userinfo")).toBe(true)
      const refresh = registration.refresh
      if (!refresh) throw new Error("Expected an OIDC refresh handler")
      const refreshed = yield* Effect.all([refresh(credential), refresh(credential)], { concurrency: "unbounded" })
      expect(refreshed.map((item) => item.access)).toEqual(["oidc-access", "oidc-access"])
      expect(fixture.requests.filter((item) => item.url === ISSUER + "/token")).toHaveLength(2)
    }),
  )

  it.live("rejects a callback with the wrong state and an ID token for another client", () =>
    Effect.gen(function* () {
      const wrongState = requester({})
      const authorization = yield* method(wrongState.send).authorize({})
      if (authorization.mode !== "auto") throw new Error("Expected loopback OAuth")
      const url = new URL(authorization.url)
      wrongState.setNonce(url.searchParams.get("nonce")!)
      const callback = new URL(url.searchParams.get("redirect_uri")!)
      callback.search = new URLSearchParams({ state: "wrong", code: "one-time-code" }).toString()
      const pending = yield* authorization.callback.pipe(Effect.forkScoped)
      const browser = yield* Effect.tryPromise(() => fetch(callback, { headers: { Connection: "close" } }))
      const completion = yield* Effect.exit(Fiber.join(pending))
      expect(browser.status).toBe(400)
      expect(Exit.isFailure(completion)).toBe(true)

      const wrongAudience = requester({ audience: "another-client" })
      const audienceAuthorization = yield* method(wrongAudience.send).authorize({})
      if (audienceAuthorization.mode !== "auto") throw new Error("Expected loopback OAuth")
      const audienceURL = new URL(audienceAuthorization.url)
      wrongAudience.setNonce(audienceURL.searchParams.get("nonce")!)
      const audienceCallback = new URL(audienceURL.searchParams.get("redirect_uri")!)
      audienceCallback.search = new URLSearchParams({
        state: audienceURL.searchParams.get("state")!,
        iss: ISSUER,
        code: "one-time-code",
      }).toString()
      const audiencePending = yield* audienceAuthorization.callback.pipe(Effect.forkScoped)
      yield* Effect.tryPromise(() => fetch(audienceCallback, { headers: { Connection: "close" } }))
      const audienceResult = yield* Effect.exit(Fiber.join(audiencePending))
      expect(Exit.isFailure(audienceResult)).toBe(true)
    }),
  )
})
