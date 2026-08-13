import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto"

export const DOMAIN = "iwan.ustc"
export const APP_SECRET = "ca6a3532abd2986a03b86b3a"
export const CONTROLLER = "https://crtl.ivpn.ustc.edu.cn"
export const AUTH_URL = "https://auth.ivpn.ustc.edu.cn/login/oauth/authorize"
export const TOKEN_URL = "https://auth.ivpn.ustc.edu.cn/api/login/oauth/access_token"
export const CLIENT_ID = "afc6479ffb531d71daef"
export const REDIRECT_URI = "com.panabit.mobile://oauth2redirect"
export const SCOPE = "openid profile email offline_access"
export const CONTROLLER_APP_ID = "controller-ustc"

export const PacketType = {
  OpenReject: 0x11,
  OpenAck: 0x12,
  Open: 0x13,
  Data: 0x14,
  EchoRequest: 0x15,
  EchoResponse: 0x16,
  Close: 0x17,
  DataEncrypted: 0x18,
} as const

export const TlvType = {
  Username: 0x01,
  Password: 0x02,
  Mtu: 0x03,
  Ip: 0x04,
  Dns: 0x05,
  Gateway: 0x06,
  Encrypt: 0x08,
  AuthVerify: 0x0f,
  ErrorMessage: 0x10,
} as const

export type AuthResult = {
  sid: number
  token: number
  tunnelIp: string
  gateway: string
  dns: string
  mtu: number
}

export function md5(data: Uint8Array | string) {
  return createHash("md5").update(data).digest()
}

export function sha256(data: Uint8Array | string) {
  return createHash("sha256").update(data).digest()
}

export function hmacSha256(key: Uint8Array | string, data: Uint8Array | string) {
  return createHmac("sha256", key).update(data).digest()
}

export function hex(data: Uint8Array) {
  return Buffer.from(data).toString("hex")
}

export function base64Url(data: Uint8Array) {
  return Buffer.from(data).toString("base64url")
}

export function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url")
}

export function randomHex(bytes: number) {
  return hex(randomBytes(bytes))
}

export function aesEcbEncrypt(key: Uint8Array, plaintext: Uint8Array) {
  if (plaintext.byteLength !== 16) throw new Error("AES-ECB plaintext must be 16 bytes")
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(key), null)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()])
}

export function aesGcmDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertextAndTag: Uint8Array, aad: Uint8Array) {
  if (ciphertextAndTag.byteLength < 16) throw new Error("AES-GCM ciphertext is missing its tag")
  const ciphertext = ciphertextAndTag.subarray(0, -16)
  const tag = ciphertextAndTag.subarray(-16)
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(nonce))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(Buffer.from(tag))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()])
}

export function xor(data: Uint8Array, key: Uint8Array) {
  if (key.byteLength === 0) return Buffer.from(data)
  const output = Buffer.from(data)
  for (let index = 0; index < output.length; index++) output[index] ^= key[index % key.length]!
  return output
}

export function sessionKey(username: string, password: string) {
  return md5(username + password)
}

export function decryptPassword(encrypted: string, domain: string, username: string) {
  const key = sha256(`${APP_SECRET}|${domain}|${username}`)
  const encoded = base64UrlDecode(encrypted)
  if (encoded.length < 28) throw new Error("iWAN server password is too short")
  const plaintext = aesGcmDecrypt(
    key,
    encoded.subarray(0, 12),
    encoded.subarray(12),
    Buffer.from(`${domain}|${username}`),
  )
  return plaintext.toString("utf8")
}

export function encryptPassword(password: string, username: string) {
  const key = md5("mw" + username)
  const plaintext = Buffer.alloc(16)
  Buffer.from(password).subarray(0, 16).copy(plaintext)
  return aesEcbEncrypt(key, plaintext)
}

export function packetHeader(type: number, encryption: number, sid: number, token: number) {
  const header = Buffer.alloc(8)
  header[0] = type
  header[1] = encryption
  header.writeUInt16BE(sid, 2)
  header.writeUInt32BE(token, 4)
  return header
}

export function signature(header: Uint8Array) {
  return md5(Buffer.concat([Buffer.from(header).subarray(0, 8), Buffer.from("mw")]))
}

export function controlPacket(header: Uint8Array, payload: Uint8Array = new Uint8Array()) {
  return Buffer.concat([Buffer.from(header).subarray(0, 8), signature(header), Buffer.from(payload)])
}

export function dataPacket(header: Uint8Array, payload: Uint8Array) {
  return Buffer.concat([Buffer.from(header).subarray(0, 8), Buffer.from(payload)])
}

export function tlv(type: number, value: Uint8Array | string) {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value)
  if (bytes.length + 2 > 255) throw new Error("iWAN TLV is too large")
  return Buffer.concat([Buffer.from([type, bytes.length + 2]), bytes])
}

export function parseTlvs(data: Uint8Array) {
  const result: Array<{ type: number; value: Buffer }> = []
  let offset = 0
  while (offset + 2 <= data.length) {
    const type = data[offset]!
    const length = data[offset + 1]!
    if (length < 2 || offset + length > data.length) break
    result.push({ type, value: Buffer.from(data.subarray(offset + 2, offset + length)) })
    offset += length
  }
  return result
}

export function buildOpen(
  username: string,
  encryptedPassword: Uint8Array,
  mtu: number,
  encryption: number,
  nonce: number,
) {
  const payload = Buffer.concat([
    tlv(TlvType.Mtu, Buffer.from([mtu >> 8, mtu & 0xff])),
    tlv(TlvType.Username, username),
    tlv(TlvType.Password, encryptedPassword),
    tlv(TlvType.Encrypt, Buffer.from([encryption])),
    tlv(TlvType.AuthVerify, u32(nonce)),
  ])
  return controlPacket(packetHeader(PacketType.Open, encryption, 0, 0), payload)
}

export function parseOpenAck(data: Uint8Array, expectedNonce: number): AuthResult {
  const packet = Buffer.from(data)
  if (packet.length < 24) throw new Error("iWAN authentication response is too short")
  const type = packet[0]!
  if (type === PacketType.OpenReject) {
    throw new Error(`iWAN authentication rejected: ${packet.subarray(24).toString("utf8")}`)
  }
  if (type !== PacketType.OpenAck) throw new Error(`unexpected iWAN packet type 0x${type.toString(16)}`)
  if (!packet.subarray(8, 24).equals(signature(packet))) throw new Error("invalid iWAN response signature")

  let tunnelIp = ""
  let gateway = ""
  let dns = ""
  let mtu = 1400
  let nonce: number | undefined
  for (const item of parseTlvs(packet.subarray(24))) {
    if (item.type === TlvType.Ip) tunnelIp = ipv4String(item.value)
    if (item.type === TlvType.Gateway) gateway = ipv4String(item.value)
    if (item.type === TlvType.Dns) dns = ipv4String(item.value)
    if (item.type === TlvType.Mtu && item.value.length >= 2) mtu = item.value.readUInt16BE(0)
    if (item.type === TlvType.AuthVerify && item.value.length === 4) nonce = item.value.readUInt32BE(0)
  }
  if (nonce !== undefined && nonce !== expectedNonce) throw new Error("iWAN authentication nonce mismatch")
  if (!tunnelIp || !gateway) throw new Error("iWAN authentication response did not include tunnel addressing")
  return {
    sid: packet.readUInt16BE(2),
    token: packet.readUInt32BE(4),
    tunnelIp,
    gateway,
    dns,
    mtu,
  }
}

export function ipv4Bytes(value: string) {
  const parts = value.split(".").map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    throw new Error(`invalid IPv4 address: ${value}`)
  return Buffer.from(parts)
}

export function ipv4String(value: Uint8Array) {
  if (value.length < 4) throw new Error("invalid IPv4 address bytes")
  return Array.from(value.subarray(0, 4)).join(".")
}

function u32(value: number) {
  const result = Buffer.alloc(4)
  result.writeUInt32BE(value >>> 0)
  return result
}

export * as IwanProtocol from "./protocol"
