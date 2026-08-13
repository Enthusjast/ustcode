type UdpSocket = Bun.udp.ConnectedSocket<"buffer">

export type UdpHandler = {
  data: (data: Buffer) => void
  error: (error: Error) => void
}

export type UdpChannel = {
  socket: UdpSocket
  setHandler: (handler: UdpHandler) => void
}

export async function connectUdp(hostname: string, port: number): Promise<UdpChannel> {
  let handler: UdpHandler = {
    data: () => {},
    error: () => {},
  }
  const socket = await Bun.udpSocket({
    connect: { hostname, port },
    socket: {
      data(_socket, data) {
        handler.data(Buffer.from(data))
      },
      error(_socket, error) {
        handler.error(error)
      },
    },
  })
  return {
    socket,
    setHandler(next) {
      handler = next
    },
  }
}

export * as IwanUdp from "./udp"
