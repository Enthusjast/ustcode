import { describe, expect, test } from "bun:test"
import {
  aesEcbEncrypt,
  buildOpen,
  controlPacket,
  parseOpenAck,
  parseTlvs,
  packetHeader,
  PacketType,
  signature,
  tlv,
  TlvType,
} from "@/iwan/protocol"

describe("iWAN protocol", () => {
  test("encrypts AES-128-ECB blocks without padding", () => {
    expect(
      aesEcbEncrypt(
        Buffer.from("000102030405060708090a0b0c0d0e0f", "hex"),
        Buffer.from("00112233445566778899aabbccddeeff", "hex"),
      ).toString("hex"),
    ).toBe("69c4e0d86a7b0430d8cdb78070b4c55a")
  })

  test("builds an OPEN packet with the Rust-compatible TLV layout", () => {
    const nonce = 0x01020304
    const packet = buildOpen("alice", Buffer.alloc(16, 0xaa), 1400, 1, nonce)
    const items = parseTlvs(packet.subarray(24))

    expect(packet[0]).toBe(PacketType.Open)
    expect(packet.subarray(8, 24)).toEqual(signature(packet))
    expect(items.map((item) => item.type)).toEqual([
      TlvType.Mtu,
      TlvType.Username,
      TlvType.Password,
      TlvType.Encrypt,
      TlvType.AuthVerify,
    ])
    expect(items[1]!.value.toString()).toBe("alice")
    expect(items[4]!.value.readUInt32BE(0)).toBe(nonce)
  })

  test("parses and validates an OPEN_ACK packet", () => {
    const nonce = 0xaabbccdd
    const payload = Buffer.concat([
      tlv(TlvType.Ip, Buffer.from([10, 0, 0, 2])),
      tlv(TlvType.Gateway, Buffer.from([10, 0, 0, 1])),
      tlv(TlvType.Dns, Buffer.from([114, 114, 114, 114])),
      tlv(TlvType.Mtu, Buffer.from([5, 120])),
      tlv(TlvType.AuthVerify, Buffer.from([0xaa, 0xbb, 0xcc, 0xdd])),
    ])
    const packet = controlPacket(packetHeader(PacketType.OpenAck, 1, 0x1234, 0x89abcdef), payload)

    expect(parseOpenAck(packet, nonce)).toEqual({
      sid: 0x1234,
      token: 0x89abcdef,
      tunnelIp: "10.0.0.2",
      gateway: "10.0.0.1",
      dns: "114.114.114.114",
      mtu: 1400,
    })
    expect(() => parseOpenAck(packet, nonce + 1)).toThrow("nonce mismatch")
  })

  test("accepts OPEN_ACK packets without an echoed nonce", () => {
    const packet = controlPacket(
      packetHeader(PacketType.OpenAck, 1, 0x1234, 0x89abcdef),
      Buffer.concat([tlv(TlvType.Ip, Buffer.from([10, 0, 0, 2])), tlv(TlvType.Gateway, Buffer.from([10, 0, 0, 1]))]),
    )

    expect(parseOpenAck(packet, 0x01020304)).toMatchObject({
      sid: 0x1234,
      token: 0x89abcdef,
      tunnelIp: "10.0.0.2",
      gateway: "10.0.0.1",
    })
  })
})
