import { Show, createMemo } from "solid-js"
import { Button } from "@ustcode-ai/ui/button"
import { Icon } from "@ustcode-ai/ui/icon"
import { Keybind } from "@ustcode-ai/ui/keybind"
import { ProviderModelIcon } from "@/providers/models/provider-group"
import { Tooltip } from "@ustcode-ai/ui/tooltip"
import { ComposerEditor } from "./editor/editor"
import { ModelSelectorPopover } from "@/providers/models/select-dialog"
import { formatKeybind, useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import type { ComposerModel } from "./model"

export function Composer(props: {
  class?: string
  model: ComposerModel
  borderUnderlay?: boolean
  readOnly?: boolean
  suggestionBoundary?: () => HTMLElement | undefined
}) {
  const command = useCommand()
  const language = useLanguage()

  return (
    <div class="flex flex-col gap-3">
      <ComposerEditor
        controller={props.model}
        borderUnderlay={props.borderUnderlay}
        readOnly={props.readOnly}
        class={props.class}
        modelControlsVisible={!props.model.model.loading}
        attachKeybind={command.keybindParts("file.attach")}
        attachShortcut={command.keybind("file.attach")}
        alternateKeybind={[formatKeybind("mod", language.t), "↵"]}
        exitShellKeybind={[formatKeybind("esc", language.t)]}
        suggestionBoundary={props.suggestionBoundary}
        modelControl={
          <ComposerModelControl
            loading={props.model.model.loading}
            title={language.t("command.model.choose")}
            keybind={command.keybindParts("model.choose")}
            model={props.model.model.selection}
            provider={props.model.model.selection.current()?.provider}
            modelName={props.model.model.selection.current()?.name ?? language.t("dialog.model.select.title")}
            onClose={props.model.restoreFocus}
          />
        }
      />
    </div>
  )
}

function ComposerModelControl(props: {
  loading: boolean
  title: string
  keybind: string[]
  model: ComposerModel["model"]["selection"]
  provider?: { id: string; canonical?: string; name: string }
  modelName: string
  onClose: () => void
}) {
  const shouldAnimate = createMemo<boolean>((previous) => previous ?? props.loading)
  const content = () => (
    <>
      <Show when={props.provider}>
        {(provider) => (
          <ProviderModelIcon
            provider={provider()}
            class="shrink-0 opacity-40 transition-opacity duration-150 group-hover:opacity-100"
          />
        )}
      </Show>
      <span class="truncate leading-4">{props.modelName}</span>
      <span class="-ml-0.5 -mr-1 flex shrink-0">
        <Icon name="chevron-down" />
      </span>
    </>
  )
  return (
    <Show when={!props.loading}>
      <Tooltip
        placement="top"
        gutter={4}
        value={
          <>
            {props.title}
            <Keybind keys={props.keybind} variant="neutral" />
          </>
        }
      >
        <ModelSelectorPopover
          model={props.model}
          trigger={(triggerProps) => (
            <Button
              {...triggerProps}
              variant="ghost-muted"
              size="normal"
              style={{ height: "28px" }}
              class="min-w-0 max-w-[220px] justify-start ![font-weight:440] group"
              classList={{ "animate-in fade-in": shouldAnimate() }}
              data-action="composer-model"
              data-control-type="popover"
            >
              {content()}
            </Button>
          )}
          onClose={props.onClose}
        />
      </Tooltip>
    </Show>
  )
}
