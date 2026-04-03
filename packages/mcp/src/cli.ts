#!/usr/bin/env node
import { LluiMcpServer } from './index.js'

const server = new LluiMcpServer()
// For now, start in stdio mode without WebSocket connection
// The debug API will be connected when available
server.start()
