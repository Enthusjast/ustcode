// @refresh reload

import pkg from "../../package.json"
import "./diagnostics"
import "./styles.css"
import { render } from "solid-js/web"
import { api } from "./api"
import { DesktopApp } from "./desktop-app"
import { startDesktopMenu } from "./platform/menu"
import { startDesktopUpdater } from "./platform/updater"
import { startDeepLinks } from "./startup/deep-links"
import { requireRendererRoot } from "./startup/root"

const root = requireRendererRoot()
const version = import.meta.env.USTCODE_VERSION ?? pkg.version

const updater = startDesktopUpdater(api)
startDesktopMenu(api)
startDeepLinks(api)

render(() => <DesktopApp api={api} updater={updater} version={version} />, root)
