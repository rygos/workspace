import { FeaturePlanAgentTools } from "../agent/featurePlans"
import { PluginActionAgentTools } from "../agent/pluginActions"
import { StagingAgentTools } from "../agent/stagingTools"
import { ReadOnlyAgentTools } from "../agent/tools"
import { WorkspaceAgentTools } from "../agent/workspaceTools"
import { WorkshopPluginHost } from "../plugins/host"
import { StagedPluginCatalog } from "../plugins/installedCatalog"
import { StagedPluginRuntime } from "../plugins/stagedRuntime"
import { PluginManagerView } from "../ui/pluginManager"
import { PluginPreviewView } from "../ui/pluginPreview"
import type { IncidentJournal } from "./incidentManager"
import type { Logger } from "./logger"
import type { AppState, Settings } from "./model"
import { isLoopback } from "./networkPolicy"
import type { Persistence } from "./persistence"
import { OpenAICompatibleProvider } from "./provider"

export type ApplicationServices = {
  readonly provider: OpenAICompatibleProvider
  readonly pluginHost: WorkshopPluginHost
  readonly pluginManager: PluginManagerView
  readonly pluginPreview: PluginPreviewView
  readonly stagedPluginRuntime: StagedPluginRuntime
  readonly agentTools: ReadOnlyAgentTools
}

export type ApplicationServiceOptions = {
  readonly persistence: Persistence
  readonly incidents: IncidentJournal
  readonly logger: Logger
  readonly getSettings: () => Settings
  readonly getWorkspaceRoot: () => AppState["workspaceRoot"]
  readonly element: <T extends HTMLElement>(selector: string) => T
}

export function createApplicationServices(options: ApplicationServiceOptions): ApplicationServices {
  const provider = new OpenAICompatibleProvider()
  const pluginHost = new WorkshopPluginHost({
    storageFor: (pluginId) => options.persistence.namespaced(pluginId),
    incidents: options.incidents,
    logger: options.logger,
  })
  const pluginManager = new PluginManagerView(pluginHost)
  const pluginActions = new PluginActionAgentTools(pluginHost, () =>
    isLoopback(options.getSettings().apiBaseUrl),
  )
  const stagedPluginRuntime = new StagedPluginRuntime(
    options.element<HTMLElement>("#staged-runtime-mount"),
    (pluginId) => options.persistence.namespaced(pluginId),
    async () => (await pluginHost.list()).map(({ manifest }) => manifest.id),
    undefined,
    {
      isQuarantined: (pluginId) => options.incidents.quarantined(pluginId),
      clearQuarantine: (pluginId) => options.incidents.setQuarantined(pluginId, false),
    },
  )
  const stagedPluginCatalog = new StagedPluginCatalog(options.persistence)
  const pluginPreview = new PluginPreviewView(
    () => options.getWorkspaceRoot() !== null,
    stagedPluginRuntime,
    stagedPluginCatalog,
  )
  const workspaceTools = new WorkspaceAgentTools(
    () => options.getWorkspaceRoot() !== null && isLoopback(options.getSettings().apiBaseUrl),
  )
  const featurePlanTools = new FeaturePlanAgentTools(
    options.persistence.namespaced("agent-plans"),
    () => isLoopback(options.getSettings().apiBaseUrl),
  )
  const stagingTools = new StagingAgentTools(
    () => isLoopback(options.getSettings().apiBaseUrl),
    () => options.getWorkspaceRoot() !== null,
    () => pluginPreview.getStatus(),
    (id) => pluginPreview.previewStagingPlugin(id),
    (id) => pluginPreview.validateStagingPlugin(id),
  )
  const agentTools = new ReadOnlyAgentTools(
    pluginHost,
    options.incidents,
    options.logger,
    workspaceTools,
    featurePlanTools,
    stagingTools,
    pluginActions,
  )
  return { provider, pluginHost, pluginManager, pluginPreview, stagedPluginRuntime, agentTools }
}
