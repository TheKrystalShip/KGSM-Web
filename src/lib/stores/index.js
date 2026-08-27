// stores/index.js — Barrel re-export. Maintains the same public API as the
// original monolithic stores.js. Import from here or from individual modules.

import { adaptServerMetrics } from "../adapters.js";

export { adaptServerMetrics };

export { __setJobTiming, serversStore, jobsStore, resolveGameNames, commandServer, sendConsoleInput, moderatePlayer, awaitJob, installServer, fetchSettings, patchSettings, previewMaintenanceWindow, deleteServer, moveServer, saveServerNote, setServerDisplayName } from "./servers.js";
export { hostsStore, syncCapabilitySubscriptions, subscribeHostMetrics, subscribeServerMetrics, fetchServerMetricsHistory, fetchHostMetricsHistory, fetchServerEvents, fetchHostDetail, addLibrary, renameLibrary, removeLibrary } from "./hosts.js";
export { filesKey, filesStore } from "./files.js";
export { serverHostId, auditEventHost, auditInScope, auditStore, AUDIT_CAP } from "./audit.js";
export { libraryStore } from "./library.js";
export { blueprintFileStore } from "./blueprintFile.js";
export { logsStore, logSourcesStore, leafLogsStore, leafLogsKey, servicesStore, subscribeHostLogs, subscribeLeafLogs, subscribeHostServices, setLeafProvisioned, fetchLeafConfig, fetchLeafCommands, applyLeafConfig, fetchLeafMetricsHistory, fetchEngineInfo, fetchLeafSchedules, fetchLeafSupervision, fetchLeafMonitorStats, fetchLeafBotStatus, fetchLeafSpeechStatus, fetchLeafReactorStatus, fetchLeafReactorDecisions } from "./diagnostics.js";
export { fetchAssistantStats, fetchAssistantReviewUsers, fetchAssistantConversations, fetchAssistantTranscript } from "./assistantReview.js";
export { favoritesStore, useIsFavorite, pingStore, startPingLoop, stopPingLoop } from "./ui.js";
export { selectionStore, useIsSelected, useSelectionIds } from "./selection.js";
export { batchesStore, runsFrom } from "./batches.js";
export { clusterStore } from "./cluster.js";
export { PREF_KEYS, prefsStore } from "./prefs.js";
export { AVAILABILITY_WINDOW, fleetOpsStore, startFleetOps, stopFleetOps } from "./fleet.js";

// The data layer is started by the shell once there is a live session, and stopped when
// there is not — importing this barrel hydrates nothing and opens no stream. See boot.js
// for why: on the sign-in screen there is nobody to fetch on behalf of.
export { startDataLayer, stopDataLayer } from "./boot.js";
