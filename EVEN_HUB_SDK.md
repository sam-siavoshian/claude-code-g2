# Even Realities Hub SDK Reference

Project: Claude Code app for G2 AR glasses. This doc is the canonical SDK reference for `@evenrealities/even_hub_sdk` (v0.0.9). Other Claude agents: read this before touching bridge/glasses code.

## Package
- Name: `@evenrealities/even_hub_sdk`
- Version: 0.0.9
- Node: ^20 || >=22
- Install: `bun add @evenrealities/even_hub_sdk`
- TypeScript: full type defs included
- Runs inside Even App WebView; auto-initializes a JS bridge.

## Core Concepts
- **Bridge**: `EvenAppBridge` singleton. Use `await waitForEvenAppBridge()` (preferred) or `EvenAppBridge.getInstance()`.
- **Coordinate system**: glasses canvas origin (0,0) top-left. X right, Y down. Canvas max ~576x288.
- **Launch source**: pushed once after load. `'appMenu' | 'glassesMenu'`. Register early via `bridge.onLaunchSource(cb)` or DOM event `evenAppLaunchSource` (`e.detail.launchSource`).
- **Lifecycle rule**: `createStartUpPageContainer` may be called EXACTLY ONCE. All subsequent page changes/new pages MUST use `rebuildPageContainer`.
- **Event capture**: when building a page, exactly ONE container must have `isEventCapture: 1`; all others `0`.
- **Container limits**: `containerTotalNum` 1–12. `textObject` max 8. `imageObject` max 4. Image max 288x144.

## Quick Start
```ts
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';

const bridge = await waitForEvenAppBridge();

bridge.onLaunchSource((source) => {
  // 'appMenu' | 'glassesMenu'
});

const user = await bridge.getUserInfo();
const device = await bridge.getDeviceInfo();

await bridge.setLocalStorage('theme', 'dark');
const theme = await bridge.getLocalStorage('theme');
```

## EvenAppBridge API

### Basic info
- `getUserInfo(): Promise<UserInfo>` — `{ uid, name, avatar, country }`
- `getDeviceInfo(): Promise<DeviceInfo | null>` — `{ model, sn, status }`
- `setLocalStorage(key, value): Promise<boolean>`
- `getLocalStorage(key): Promise<string>` (empty string if missing)

### Event listeners (all return unsubscribe fn)
- `onLaunchSource(cb: (source: LaunchSource) => void)`
- `onDeviceStatusChanged(cb: (status: DeviceStatus) => void)`
- `onEvenHubEvent(cb: (event: EvenHubEvent) => void)`

### Glasses UI — EvenHub
- `createStartUpPageContainer(cfg: CreateStartUpPageContainer): Promise<StartUpPageCreateResult>`
  - Result: `0 Success | 1 Invalid | 2 Oversize | 3 OutOfMemory`
  - CALL ONCE ONLY. Image containers appear as placeholders until `updateImageRawData` is called.
- `rebuildPageContainer(cfg: RebuildPageContainer): Promise<boolean>` — same shape as create; use for every subsequent page update.
- `updateImageRawData(data: ImageRawDataUpdate): Promise<ImageRawDataUpdateResult>`
  - `imageData` preferred as `number[]` (base64 string / Uint8Array / ArrayBuffer also accepted; SDK converts).
  - Serialize image sends — NEVER concurrent. Wait for previous to resolve. Keep frequency low (limited glasses memory). Prefer simple, high-contrast imagery.
- `textContainerUpgrade(cfg: TextContainerUpgrade): Promise<boolean>`
  - `containerName` ≤ 16 chars, `content` ≤ 2000 chars.
- `audioControl(isOpen: boolean): Promise<boolean>` — mic on/off. REQUIRES `createStartUpPageContainer` first. PCM arrives via `onEvenHubEvent` → `event.audioEvent.audioPcm: Uint8Array`.
- `imuControl(isOpen: boolean, reportFrq?: ImuReportPace): Promise<boolean>` — REQUIRES `createStartUpPageContainer` first. `reportFrq` is `ImuReportPace.P100..P1000` (step 100; protocol pacing code, NOT literal Hz). IMU samples arrive as `event.sysEvent.imuData` with `eventType === OsEventTypeList.IMU_DATA_REPORT`.
- `shutDownPageContainer(exitMode?: 0 | 1): Promise<boolean>` — `0` exit immediately, `1` show interaction layer.
- `callEvenApp(method: EvenAppMethod | string, params?: any): Promise<any>` — generic escape hatch.

## Container Property Models

### ListContainerProperty
```ts
{
  xPosition?: 0..576;
  yPosition?: 0..288;
  width?: 0..576;
  height?: 0..288;
  borderWidth?: 0..5;
  borderColor?: 0..15;
  borderRadius?: 0..10;
  paddingLength?: 0..32;
  containerID?: number;        // random
  containerName?: string;      // ≤16 chars
  itemContainer?: ListItemContainerProperty;
  isEventCapture?: 0 | 1;
}
```

### ListItemContainerProperty
```ts
{
  itemCount?: 1..20;
  itemWidth?: number;          // 0 = auto fill
  isItemSelectBorderEn?: 0 | 1;
  itemName?: string[];         // ≤20 items, each ≤64 chars
}
```

### TextContainerProperty
```ts
{
  xPosition?: 0..576;
  yPosition?: 0..288;
  width?: 0..576;
  height?: 0..288;
  borderWidth?: 0..5;
  borderColor?: 0..16;
  borderRadius?: 0..10;
  paddingLength?: 0..32;
  containerID?: number;
  containerName?: string;      // ≤16 chars
  isEventCapture?: 0 | 1;
  content?: string;            // ≤1000 chars at startup (keep minimal)
}
```

### TextContainerUpgrade
```ts
{
  containerID?: number;
  containerName?: string;      // ≤16 chars
  contentOffset?: number;
  contentLength?: number;
  content?: string;            // ≤2000 chars
}
```

### ImageContainerProperty
```ts
{
  xPosition?: 0..576;
  yPosition?: 0..288;
  width?: 20..288;
  height?: 20..144;
  containerID?: number;
  containerName?: string;      // ≤16 chars
}
```
Image content is NOT sent at startup; call `updateImageRawData` after create/rebuild succeeds.

### ImageRawDataUpdate
```ts
{
  containerID?: number;
  containerName?: string;
  imageData?: number[] | string | Uint8Array | ArrayBuffer;
}
```

### CreateStartUpPageContainer / RebuildPageContainer
```ts
{
  containerTotalNum?: 1..12;
  widgetId?: number;           // usually auto-filled by bridge
  listObject?: ListContainerProperty[];
  textObject?: TextContainerProperty[];   // ≤8
  imageObject?: ImageContainerProperty[]; // ≤4
}
```

## Data Models

### UserInfo
`{ uid: number; name: string; avatar: string; country: string }` — `toJson()`, static `fromJson`, `createDefault`.

### DeviceInfo
`{ readonly model: DeviceModel; readonly sn: string; status: DeviceStatus }`
Methods: `updateStatus(s)` (only if `s.sn === this.sn`), `isGlasses()`, `isRing()`, `toJson()`. Static `fromJson`.

### DeviceStatus
```ts
{
  readonly sn: string;
  connectType: DeviceConnectType;
  isWearing?: boolean;
  batteryLevel?: 0..100;
  isCharging?: boolean;
  isInCase?: boolean;
}
```
Helpers: `isNone`, `isConnected`, `isConnecting`, `isDisconnected`, `isConnectionFailed`. Static `fromJson`, `createDefault(sn?)`.

### EvenHubEvent
```ts
{
  listEvent?: List_ItemEvent;
  textEvent?: Text_ItemEvent;
  sysEvent?: Sys_ItemEvent;     // includes imuData when IMU on
  audioEvent?: { audioPcm: Uint8Array };
  jsonData?: Record<string, any>;
}
```
Dispatch by checking which field is present.

### List_ItemEvent
`{ containerID?, containerName?, currentSelectItemName?, currentSelectItemIndex?, eventType? }`

### Text_ItemEvent
`{ containerID?, containerName?, eventType? }`

### Sys_ItemEvent
`{ eventType?: OsEventTypeList, eventSource?: EventSourceType, imuData?: IMU_Report_Data, systemExitReasonCode?: number }`

### IMU_Report_Data
`{ x?: number; y?: number; z?: number }` (protobuf float)

## Enums

### EvenAppMethod
`GetUserInfo | GetGlassesInfo | SetLocalStorage | GetLocalStorage | CreateStartUpPageContainer | RebuildPageContainer | UpdateImageRawData | TextContainerUpgrade | AudioControl | ImuControl | ShutDownPageContainer`

### DeviceConnectType
`None | Connecting | Connected | Disconnected | ConnectionFailed`

### StartUpPageCreateResult
`Success=0 | Invalid=1 | Oversize=2 | OutOfMemory=3`

### ImuReportPace
`P100, P200, P300, ... P1000` (step 100)

### OsEventTypeList
Includes `SYSTEM_EXIT_EVENT`, `IMU_DATA_REPORT`, etc.

### EventSourceType
Input source for `Sys_ItemEvent.eventSource` (glasses L/R, ring, ...).

### EvenHubErrorCodeName
Host result codes, e.g. `APP_REQUEST_AUDIO_CTR_SUCCESS`, `APP_REQUEST_AUDIO_CTR_FAILED`, plus create/rebuild/shutdown/heartbeat codes.

### LaunchSource
`'appMenu' | 'glassesMenu'`. Constants: `LAUNCH_SOURCE_APP_MENU`, `LAUNCH_SOURCE_GLASSES_MENU`.

## App → Web Push Message Shapes
Host calls `window._listenEvenAppMessage(msg)`.

Launch source:
```json
{ "method": "evenAppLaunchSource", "data": { "launchSource": "appMenu" } }
```

Device status:
```json
{
  "type": "listen_even_app_data",
  "method": "deviceStatusChanged",
  "data": { "sn": "SN", "connectType": "connected", "isWearing": true, "batteryLevel": 80, "isCharging": false, "isInCase": false }
}
```

EvenHub event:
```json
{
  "type": "listen_even_app_data",
  "method": "evenHubEvent",
  "data": { "type": "listEvent", "jsonData": { "containerID": 1, "currentSelectItemName": "item1" } }
}
```
Audio: `data.type === 'audioEvent'`, `jsonData.audioPcm` as `number[]` or base64 → parsed into `Uint8Array`.

SDK also tolerates: `{ type, data }`, `['list_event', {...}]`.

## Critical Rules / Gotchas
1. `createStartUpPageContainer` ONCE per session. Use `rebuildPageContainer` for everything after.
2. Exactly one container per page has `isEventCapture: 1`.
3. Image container creation only reserves space — always follow with `updateImageRawData`.
4. Image updates must be SERIAL (queue; await each). Glasses memory is tight — don't spam.
5. `audioControl` and `imuControl` require a successful `createStartUpPageContainer` first.
6. Listener cleanup: always call the returned unsubscribe on unmount to prevent leaks.
7. `DeviceInfo.model` and `sn` are immutable; only `status` updates, and only when `sn` matches.
8. Register `onLaunchSource` as early as possible — it's pushed once.
9. `ImuReportPace` values are PROTOCOL PACING CODES, not Hz.
10. Keep startup text/content minimal for transmission efficiency.

## Relevance to Claude Code on G2
- Output rendering: use text containers (chunk long Claude output into `textContainerUpgrade` calls; remember 2000 char cap).
- Input: list containers for command/menu selection; `isEventCapture: 1` on the active list.
- Voice → Claude: `audioControl(true)` then stream PCM from `audioEvent.audioPcm` to an STT pipeline.
- Head gestures / motion cues: `imuControl` + `sysEvent.imuData`.
- Persist session/auth/tokens via `setLocalStorage` / `getLocalStorage`.
- Entry: branch on `onLaunchSource` (glasses menu vs app menu) to choose UI mode.

## Contact
Author: Whiskee Chen — whiskee.chen@evenrealities.com. License: MIT.
