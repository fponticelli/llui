import { handleLapDescribe } from './describe.js'
import {
  handleLapState,
  handleLapActions,
  handleLapQueryDom,
  handleLapDescribeVisible,
  handleLapContext,
  type ForwardDeps,
} from './forward.js'
import { handleLapMessage } from './message.js'
import { handleLapWait } from './wait.js'
import { handleLapConfirmResult } from './confirm-result.js'
import { handleLapObserve } from './observe.js'

export type LapRouterDeps = ForwardDeps

export function createLapRouter(
  deps: LapRouterDeps,
  basePath: string,
): (req: Request) => Promise<Response | null> {
  return async (req) => {
    const url = new URL(req.url)
    const path = url.pathname
    if (!path.startsWith(basePath + '/')) return null
    const tail = path.slice(basePath.length)
    switch (tail) {
      case '/describe':
        return handleLapDescribe(req, deps)
      case '/state':
        return handleLapState(req, deps)
      case '/actions':
        return handleLapActions(req, deps)
      case '/message':
        return handleLapMessage(req, deps)
      case '/confirm-result':
        return handleLapConfirmResult(req, deps)
      case '/wait':
        return handleLapWait(req, deps)
      case '/query-dom':
        return handleLapQueryDom(req, deps)
      case '/describe-visible':
        return handleLapDescribeVisible(req, deps)
      case '/context':
        return handleLapContext(req, deps)
      case '/observe':
        return handleLapObserve(req, deps)
      default:
        return null
    }
  }
}
