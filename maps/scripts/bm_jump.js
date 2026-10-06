import { Instance } from "cs_script/point_script";

const LAST_TEXT  = "course_last_text";
const BEST_TEXT  = "course_best_text";

const runStart = new Map();

let bestTime = null;
let bestName = "";

function formatTime(seconds) {
    const total = Math.round(seconds * 100);
    const mins  = Math.floor(total / 6000);
    const secs  = Math.floor(total / 100) % 60;
    const cs    = total % 100;
    return `${mins}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function getPlayer(inputData) {
    const pawn = inputData.activator;
    if (!pawn || !pawn.IsValid() || typeof pawn.GetPlayerController !== "function") return undefined;
    const controller = pawn.GetPlayerController();
    if (!controller) return undefined;
    return { pawn, controller, slot: controller.GetPlayerSlot() };
}

function setText(name, message) {
    Instance.EntFireAtName({ name, input: "SetMessage", value: message });
}

Instance.OnScriptInput("StartTimer", (inputData) => {
    const p = getPlayer(inputData);
    if (!p) return;
    runStart.set(p.slot, Instance.GetGameTime());
});

Instance.OnScriptInput("StopTimer", (inputData) => {
    const p = getPlayer(inputData);
    if (!p) return;

    const start = runStart.get(p.slot);
    if (start === undefined) return;
    runStart.delete(p.slot);

    const time = Instance.GetGameTime() - start;
    const name = p.controller.GetPlayerName();

    let lastMsg = `${name}: ${formatTime(time)}`;
    if (bestTime === null || time < bestTime) {
        bestTime = time;
        bestName = name;
        lastMsg += "  NEW RECORD!";
    }

    setText(LAST_TEXT, lastMsg);
    setText(BEST_TEXT, `Record: ${bestName} - ${formatTime(bestTime)}`);
});

Instance.OnScriptInput("CancelTimer", (inputData) => {
    const p = getPlayer(inputData);
    if (p) runStart.delete(p.slot);
});

Instance.OnPlayerReset((event) => {
    const controller = event.player.GetPlayerController();
    if (controller) runStart.delete(controller.GetPlayerSlot());
});

Instance.OnPlayerDisconnect((event) => {
    runStart.delete(event.playerSlot);
});

Instance.OnActivate(() => {
    setText(LAST_TEXT, "Finish the course to set a time");
    setText(BEST_TEXT, "Record: none yet");
});
