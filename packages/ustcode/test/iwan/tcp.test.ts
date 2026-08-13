import { describe, expect, test } from "bun:test"
import { buildTcpPacket, parseTcpOptions, parseTcpPacket, sequenceEnd, TcpFlags } from "@/iwan/tcp"

describe("iWAN TCP packet adapter", () => {
  test("round-trips IPv4/TCP headers and payloads", () => {
    const packet = buildTcpPacket({
      source: "10.0.0.2",
      destination: "192.0.2.10",
      sourcePort: 49152,
      destinationPort: 443,
      sequence: 0x10203040,
      acknowledgement: 0x50607080,
      flags: TcpFlags.syn | TcpFlags.ack,
      window: 65535,
      payload: Buffer.from("hello"),
      identification: 0x1234,
    })

    expect(parseTcpPacket(packet)).toMatchObject({
      source: "10.0.0.2",
      destination: "192.0.2.10",
      sourcePort: 49152,
      destinationPort: 443,
      sequence: 0x10203040,
      acknowledgement: 0x50607080,
      flags: TcpFlags.syn | TcpFlags.ack,
      window: 65535,
    })
    expect(parseTcpPacket(packet)?.payload).toEqual(Buffer.from("hello"))
  })

  test("counts SYN and FIN as sequence-consuming bytes", () => {
    expect(sequenceEnd({ sequence: 100, flags: TcpFlags.syn, payload: Buffer.alloc(0) })).toBe(101)
    expect(sequenceEnd({ sequence: 100, flags: TcpFlags.ack, payload: Buffer.from("hello") })).toBe(105)
    expect(sequenceEnd({ sequence: 100, flags: TcpFlags.fin | TcpFlags.ack, payload: Buffer.alloc(0) })).toBe(101)
  })

  test("round-trips negotiated TCP options", () => {
    const options = Buffer.from([2, 4, 5, 60, 3, 3, 4, 4, 2, 0, 0, 0])
    const packet = buildTcpPacket({
      source: "10.0.0.2",
      destination: "192.0.2.10",
      sourcePort: 49152,
      destinationPort: 443,
      sequence: 1,
      acknowledgement: 0,
      flags: TcpFlags.syn,
      options,
    })

    expect(parseTcpPacket(packet)?.options).toEqual(options)
    expect(parseTcpOptions(options)).toEqual({ mss: 1340, windowScale: 4, sackPermitted: true })
  })

  test("rejects packets without a complete IPv4/TCP header", () => {
    expect(parseTcpPacket(Buffer.alloc(39))).toBeUndefined()
    expect(parseTcpPacket(Buffer.from([0x45, 0, 0, 40]))).toBeUndefined()
  })
})
