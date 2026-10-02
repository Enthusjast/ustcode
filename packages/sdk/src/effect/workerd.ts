export * as USTCodeWorkerd from "./workerd"

import { Layer } from "effect"
import type { Config, Scope } from "effect"
import { WorkerdProfile } from "../internal/workerd"
import { USTCode } from "./ustcode"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions<R = never> extends WorkerdProfile.Options {
  readonly log?: USTCode.CreateOptions["log"]
  readonly workspaceProviders?: USTCode.CreateOptions["workspaceProviders"]
  readonly instances?: USTCode.CreateOptions<R>["instances"]
}

export const create = <R = never>({ log, workspaceProviders, instances, ...options }: CreateOptions<R>) => {
  const profile = WorkerdProfile.make(options)
  return USTCode.create(
    { ...profile.options, log, workspaceProviders, instances },
    { overrides: profile.replacements },
  )
}

export const layer = <R = never>(
  options: CreateOptions<R>,
): Layer.Layer<USTCode.Service, Config.ConfigError | Error, Exclude<R, Scope.Scope>> =>
  Layer.effect(USTCode.Service, create(options))

export type Interface = USTCode.Interface
export type Requirements = Scope.Scope
