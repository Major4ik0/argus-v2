import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'

export interface WebSocketMessage {
  event?: string
  type?: string
  recognized?: boolean
  name?: string | null
  similarity?: number
  teacher_id?: number | null
  teacher_name?: string
  confidence?: number
  kiosk_theme?: string
  settings?: any
  message?: string
  [key: string]: any
}

interface WebSocketContextType {
  isConnected: boolean
  lastMessage: WebSocketMessage | null
  sendMessage: (message: string | object) => void
}

const WebSocketContext = createContext<WebSocketContextType | null>(null)

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<any>(null)
  const pingIntervalRef = useRef<any>(null)
  const retryAttemptRef = useRef<number>(0)

  const sendMessage = useCallback((message: string | object) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const payload = typeof message === 'string' ? message : JSON.stringify(message)
      socketRef.current.send(payload)
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    const backoffDelays = [1000, 2000, 5000]

    const connect = () => {
      if (!isMounted) return

      // Очищаем старые таймеры перед новой попыткой
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
        pingIntervalRef.current = null
      }

      // Если предыдущий сокет еще открыт или открывается - закрываем корректно
      if (socketRef.current) {
        socketRef.current.onopen = null
        socketRef.current.onmessage = null
        socketRef.current.onerror = null
        socketRef.current.onclose = null
        try {
          socketRef.current.close()
        } catch {}
        socketRef.current = null
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/v1/kiosk/ws`

      try {
        const ws = new WebSocket(wsUrl)
        socketRef.current = ws

        ws.onopen = () => {
          if (!isMounted) return
          setIsConnected(true)
          retryAttemptRef.current = 0

          // Запуск пинга для поддержания соединения каждые 10 секунд
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send('ping')
              } catch {}
            }
          }, 10000)
        }

        ws.onmessage = (event) => {
          if (!isMounted) return
          if (event.data === 'pong') {
            setIsConnected(true)
            return
          }
          try {
            const data = JSON.parse(event.data)
            setLastMessage(data)
          } catch {}
        }

        ws.onerror = () => {
          if (!isMounted) return
          setIsConnected(false)
        }

        ws.onclose = () => {
          if (!isMounted) return
          setIsConnected(false)
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current)
            pingIntervalRef.current = null
          }

          const delayIndex = Math.min(retryAttemptRef.current, backoffDelays.length - 1)
          const delay = backoffDelays[delayIndex]
          retryAttemptRef.current += 1

          reconnectTimeoutRef.current = setTimeout(() => {
            if (isMounted) {
              connect()
            }
          }, delay)
        }
      } catch {
        if (!isMounted) return
        setIsConnected(false)
        const delayIndex = Math.min(retryAttemptRef.current, backoffDelays.length - 1)
        const delay = backoffDelays[delayIndex]
        retryAttemptRef.current += 1
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMounted) {
            connect()
          }
        }, delay)
      }
    }

    connect()

    return () => {
      isMounted = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
        pingIntervalRef.current = null
      }
      if (socketRef.current) {
        socketRef.current.onopen = null
        socketRef.current.onmessage = null
        socketRef.current.onerror = null
        socketRef.current.onclose = null
        try {
          socketRef.current.close()
        } catch {}
        socketRef.current = null
      }
    }
  }, [])

  return (
    <WebSocketContext.Provider value={{ isConnected, lastMessage, sendMessage }}>
      {children}
    </WebSocketContext.Provider>
  )
}

export const useKioskSocket = (): WebSocketContextType => {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useKioskSocket must be used within a WebSocketProvider')
  }
  return context
}
