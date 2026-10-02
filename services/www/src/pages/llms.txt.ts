import type { APIRoute } from "astro"
import { renderLlmsTxt } from "../docs/lib/llms"

export const prerender = true

export const GET: APIRoute = ({ site }) =>
  new Response(renderLlmsTxt(site ?? new URL("https://ustcode.enthusjast.cc")), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
