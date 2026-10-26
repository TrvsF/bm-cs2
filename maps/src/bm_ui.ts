import { Instance, Console, CSInputs } from "cs_script/point_script";
import type { Entity, CSPlayerPawn, CSPlayerController, CustomHudLayout } from "cs_script/point_script";
import { LogPrefix, ForEachLivePawn } from "./bm_core";
import { EPlayerClass, ClassDefinitions } from "./bm_classes";
import type { FHudCounter } from "./bm_classes";
import type { FLauncherAmmo } from "./bm_launcher";
import type { FPayloadStatus } from "./bm_payload";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export type FClassMenuChoice = EPlayerClass | "close" | undefined;

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const ClassUiName: string = "class_hud";
const MenuPanelId: string = "ClassMenu";
const HudCardsId: string = "HudCards";
const CentreBarId: string = "CentreBar";
const IndicatorPanelId: string = "ClassIndicator";
const ClassNameLabelId: string = "ClassName";
const PickButtonPrefix: string = "Pick_";
const CloseButtonId: string = "CloseMenu";
const MenuToggleKey: CSInputs = CSInputs.USE;
const NoClassName: string = "No class";
const AmmoPanelId: string = "AmmoPanel";
const AmmoClipLabelId: string = "AmmoClip";
const AmmoSpareLabelId: string = "AmmoSpare";
const HealthPanelId: string = "HealthPanel";
const HealthValueLabelId: string = "HealthValue";
const HealthMaxLabelId: string = "HealthMax";
const CounterPanelId: string = "CounterPanel";
const CounterLabelId: string = "CounterLabel";
const CounterValueId: string = "CounterValue";
const CounterMaxId: string = "CounterMax";
const ChargeBarId: string = "ChargeBar";
const ReloadBarId: string = "ReloadBar";
const BarSteps: number = 24;
const BarCharacter: string = "0";
const HiddenBar: number = -1;
const PayloadBarId: string = "PayloadBar";
const PayloadSectionPrefix: string = "PayloadSection";
const PayloadTickPrefix: string = "PayloadTick";
const PayloadPushersLabelId: string = "PayloadPushers";
const PayloadBarSteps: number = 60;
const MaxPayloadTicks: number = 5;
const PayloadStateClasses: readonly string[] = ["Pushing", "Blocked", "RollingBack", "Overtime", "Delivered"];
const HurtHealthFraction: number = 0.5;
const CriticalHealthFraction: number = 0.25;

const AllClasses: readonly EPlayerClass[] = Object.values(EPlayerClass);

const GOpenMenus: Set<number> = new Set<number>();
const GOfferedMenus: Set<number> = new Set<number>();
const GShownAmmo: Map<number, string> = new Map<number, string>();
const GShownHealth: Map<number, string> = new Map<number, string>();
const GShownBars: Map<number, Map<string, number>> = new Map<number, Map<string, number>>();
const GShownCounter: Map<number, string> = new Map<number, string>();
const GSentPayload: Map<number, Map<string, string>> = new Map<number, Map<string, string>>();
let GbWarnedNoClassUi: boolean = false;

// Menu ////////////////////////////////////////////////////////////////////////////////////////////

export function OpenClassMenu(Slot: number): void
{
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	GOpenMenus.add(Slot);
	Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", true);
	Ui.SetInputCaptureEnabled(Slot, true);
}

export function CloseClassMenu(Slot: number): void
{
	GOpenMenus.delete(Slot);
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", false);
	Ui.SetInputCaptureEnabled(Slot, false);
}

export function ToggleClassMenu(Slot: number): void
{
	if (GOpenMenus.has(Slot))
	{
		CloseClassMenu(Slot);
	}
	else
	{
		OpenClassMenu(Slot);
	}
}

export function OfferClassMenu(Slot: number, PlayerClass: EPlayerClass): void
{
	if (GOfferedMenus.has(Slot) || PlayerClass !== EPlayerClass.None)
	{
		return;
	}
	GOfferedMenus.add(Slot);
	OpenClassMenu(Slot);
}

export function TickClassMenuKey(): void
{
	ForEachLivePawn((Pawn: CSPlayerPawn, Slot: number): void =>
	{
		const Controller: CSPlayerController | undefined = Pawn.GetPlayerController();
		if (!Controller || Controller.IsBot())
		{
			return;
		}
		if (Pawn.WasInputJustPressed(MenuToggleKey))
		{
			ToggleClassMenu(Slot);
		}
	});
}

export function ReadClassMenuClick(Layout: CustomHudLayout, ButtonId: string): FClassMenuChoice
{
	if (Layout.GetEntityName() !== ClassUiName)
	{
		return undefined;
	}
	if (ButtonId === CloseButtonId)
	{
		return "close";
	}
	if (!ButtonId.startsWith(PickButtonPrefix))
	{
		return undefined;
	}
	const ClassValue: string = ButtonId.substring(PickButtonPrefix.length);
	for (const PlayerClass of AllClasses)
	{
		if (PlayerClass === ClassValue)
		{
			return PlayerClass;
		}
	}
	return undefined;
}

// Indicator ///////////////////////////////////////////////////////////////////////////////////////

export function ShowClassIndicator(Slot: number, PlayerClass: EPlayerClass, IsT: boolean): void
{
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}

	const DisplayName: string = PlayerClass === EPlayerClass.None ? NoClassName : ClassDefinitions[PlayerClass].Settings.DisplayName;
	Ui.SetDialogVariableStringForPlayer(Slot, ClassNameLabelId, "classname", DisplayName);
	Ui.SetHasClassForPlayer(Slot, HudCardsId, "Team_t", IsT);
	Ui.SetHasClassForPlayer(Slot, HudCardsId, "Team_ct", !IsT);
	Ui.SetHasClassForPlayer(Slot, IndicatorPanelId, "Shown", true);

	if (GOpenMenus.has(Slot))
	{
		Ui.SetHasClassForPlayer(Slot, MenuPanelId, "Open", true);
		Ui.SetInputCaptureEnabled(Slot, true);
	}
}

export function ShowAmmo(Slot: number, Ammo: FLauncherAmmo | undefined): void
{
	ShowBar(Slot, ChargeBarId, Ammo && Ammo.ChargeFraction > 0 ? Ammo.ChargeFraction : undefined);
	ShowBar(Slot, ReloadBarId, Ammo && Ammo.bReloading ? Ammo.ReloadFraction : undefined);

	const Key: string = Ammo ? `${Ammo.Clip}|${Ammo.MaxClip}|${Ammo.bReloading}` : "";
	if ((GShownAmmo.get(Slot) ?? "") === Key)
	{
		return;
	}
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	GShownAmmo.set(Slot, Key);

	if (!Ammo)
	{
		Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Shown", false);
		return;
	}
	Ui.SetDialogVariableStringForPlayer(Slot, AmmoClipLabelId, "ammoclip", `${Ammo.Clip}`);
	Ui.SetDialogVariableStringForPlayer(Slot, AmmoSpareLabelId, "ammospare", `${Ammo.MaxClip}`);
	Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Reloading", Ammo.bReloading);
	Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Empty", Ammo.Clip === 0);
	Ui.SetHasClassForPlayer(Slot, AmmoPanelId, "Shown", true);
}

// The HUD can't be given a width, only text, so a bar is two labels side by side: <Id>Fill holding the filled part
// and <Id>Empty the rest, each a run of BarCharacter. CSS hides the characters and colours the labels' backgrounds,
// so the fill's width comes straight from Fraction. undefined hides the bar.
function ShowBar(Slot: number, BarId: string, Fraction: number | undefined): void
{
	const Steps: number = Fraction === undefined ? HiddenBar : Math.floor(Math.min(1, Math.max(0, Fraction)) * BarSteps);
	let ShownBars: Map<string, number> | undefined = GShownBars.get(Slot);
	if (!ShownBars)
	{
		ShownBars = new Map<string, number>();
		GShownBars.set(Slot, ShownBars);
	}
	const LastSteps: number = ShownBars.get(BarId) ?? HiddenBar;
	if (Steps === LastSteps)
	{
		return;
	}
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	ShownBars.set(BarId, Steps);

	if (Steps === HiddenBar)
	{
		Ui.SetHasClassForPlayer(Slot, BarId, "Shown", false);
		return;
	}
	Ui.SetDialogVariableStringForPlayer(Slot, `${BarId}Fill`, "fill", BarCharacter.repeat(Steps));
	Ui.SetDialogVariableStringForPlayer(Slot, `${BarId}Empty`, "empty", BarCharacter.repeat(BarSteps - Steps));
	if (LastSteps === HiddenBar)
	{
		Ui.SetHasClassForPlayer(Slot, BarId, "Shown", true);
	}
}

// A class's counter (e.g. stickies out), at the right end of the ammo side of the bar. undefined hides it.
export function ShowCounter(Slot: number, Counter: FHudCounter | undefined): void
{
	const Key: string = Counter ? `${Counter.Label}|${Counter.Count}|${Counter.Max}` : "";
	if ((GShownCounter.get(Slot) ?? "") === Key)
	{
		return;
	}
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	GShownCounter.set(Slot, Key);

	if (!Counter)
	{
		Ui.SetHasClassForPlayer(Slot, CounterPanelId, "Shown", false);
		return;
	}
	Ui.SetDialogVariableStringForPlayer(Slot, CounterLabelId, "counterlabel", Counter.Label);
	Ui.SetDialogVariableStringForPlayer(Slot, CounterValueId, "countervalue", `${Counter.Count}`);
	Ui.SetDialogVariableStringForPlayer(Slot, CounterMaxId, "countermax", Counter.Max > 0 ? `/ ${Counter.Max}` : "");
	Ui.SetHasClassForPlayer(Slot, CounterPanelId, "HasAny", Counter.Count > 0);
	Ui.SetHasClassForPlayer(Slot, CounterPanelId, "Full", Counter.Max > 0 && Counter.Count >= Counter.Max);
	Ui.SetHasClassForPlayer(Slot, CounterPanelId, "Shown", true);
}

export function ShowPayload(Slot: number, Status: FPayloadStatus | undefined): void
{
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	let Sent: Map<string, string> | undefined = GSentPayload.get(Slot);
	if (!Sent)
	{
		Sent = new Map<string, string>();
		GSentPayload.set(Slot, Sent);
	}
	if (!Status)
	{
		SetPayloadClass(Ui, Slot, Sent, PayloadBarId, "Shown", false);
		return;
	}

	const Boundaries: number[] = [0, ...Status.CheckpointFractions.slice(0, MaxPayloadTicks), 1];
	const Filled: number = Math.floor(Math.min(1, Math.max(0, Status.Progress)) * PayloadBarSteps);
	for (let Section: number = 0; Section <= MaxPayloadTicks; Section++)
	{
		const bUsed: boolean = Section < Boundaries.length - 1;
		const Start: number = bUsed ? Math.round((Boundaries[Section] ?? 1) * PayloadBarSteps) : PayloadBarSteps;
		const End: number = bUsed ? Math.round((Boundaries[Section + 1] ?? 1) * PayloadBarSteps) : PayloadBarSteps;
		const Fill: number = Math.min(Math.max(Filled - Start, 0), End - Start);
		SendPayloadText(Ui, Slot, Sent, `${PayloadSectionPrefix}${Section}Fill`, "fill", BarCharacter.repeat(Fill));
		SendPayloadText(Ui, Slot, Sent, `${PayloadSectionPrefix}${Section}Empty`, "empty", BarCharacter.repeat(End - Start - Fill));
	}
	for (let Tick: number = 1; Tick <= MaxPayloadTicks; Tick++)
	{
		SetPayloadClass(Ui, Slot, Sent, `${PayloadTickPrefix}${Tick}`, "Shown", Tick < Boundaries.length - 1);
		SetPayloadClass(Ui, Slot, Sent, `${PayloadTickPrefix}${Tick}`, "Reached", Tick <= Status.CheckpointsReached);
	}

	const State: string = GetPayloadState(Status);
	for (const StateClass of PayloadStateClasses)
	{
		SetPayloadClass(Ui, Slot, Sent, PayloadBarId, StateClass, StateClass === State);
	}
	SendPayloadText(Ui, Slot, Sent, PayloadPushersLabelId, "pushers", State === "Pushing" ? `x${Status.Pushers}` : "");
	SetPayloadClass(Ui, Slot, Sent, PayloadBarId, "Shown", true);
}

function GetPayloadState(Status: FPayloadStatus): string
{
	if (Status.bDelivered)
	{
		return "Delivered";
	}
	if (Status.bOvertime)
	{
		return "Overtime";
	}
	if (Status.bBlocked)
	{
		return "Blocked";
	}
	if (Status.Pushers > 0)
	{
		return "Pushing";
	}
	return Status.bRollingBack ? "RollingBack" : "";
}

// The payload bar is a lot of small pieces, so each is only sent when it changes
function SendPayloadText(Ui: CustomHudLayout, Slot: number, Sent: Map<string, string>, LabelId: string, VariableName: string, Text: string): void
{
	const Key: string = `${LabelId}|${VariableName}`;
	if (Sent.get(Key) === Text)
	{
		return;
	}
	Sent.set(Key, Text);
	Ui.SetDialogVariableStringForPlayer(Slot, LabelId, VariableName, Text);
}

function SetPayloadClass(Ui: CustomHudLayout, Slot: number, Sent: Map<string, string>, PanelId: string, ClassName: string, bHasClass: boolean): void
{
	const Key: string = `${PanelId}.${ClassName}`;
	const Value: string = bHasClass ? "1" : "0";
	if ((Sent.get(Key) ?? "0") === Value)
	{
		return;
	}
	Sent.set(Key, Value);
	Ui.SetHasClassForPlayer(Slot, PanelId, ClassName, bHasClass);
}

export function ShowHealth(Slot: number, Pawn: CSPlayerPawn | undefined): void
{
	const Health: number = Pawn ? Pawn.GetHealth() : 0;
	const MaxHealth: number = Pawn ? Math.max(1, Pawn.GetMaxHealth()) : 1;
	const Key: string = Pawn ? `${Health}|${MaxHealth}` : "";
	if ((GShownHealth.get(Slot) ?? "") === Key)
	{
		return;
	}
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	GShownHealth.set(Slot, Key);

	if (!Pawn)
	{
		Ui.SetHasClassForPlayer(Slot, CentreBarId, "Shown", false);
		return;
	}
	const Fraction: number = Health / MaxHealth;
	Ui.SetDialogVariableStringForPlayer(Slot, HealthValueLabelId, "health", `${Health}`);
	Ui.SetDialogVariableStringForPlayer(Slot, HealthMaxLabelId, "maxhealth", `${MaxHealth}`);
	Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Overhealed", Health > MaxHealth);
	Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Hurt", Fraction <= HurtHealthFraction && Fraction > CriticalHealthFraction);
	Ui.SetHasClassForPlayer(Slot, HealthPanelId, "Critical", Fraction <= CriticalHealthFraction);
	Ui.SetHasClassForPlayer(Slot, CentreBarId, "Shown", true);
}

export function ResetClassUi(Slot: number): void
{
	GOpenMenus.delete(Slot);
	GOfferedMenus.delete(Slot);
	GShownAmmo.delete(Slot);
	GShownHealth.delete(Slot);
	GShownBars.delete(Slot);
	GShownCounter.delete(Slot);
	GSentPayload.delete(Slot);
	const Ui: CustomHudLayout | undefined = FindClassUi();
	if (!Ui)
	{
		return;
	}
	Ui.SetInputCaptureEnabled(Slot, false);
	Ui.ResetForPlayer(Slot);
}

function FindClassUi(): CustomHudLayout | undefined
{
	const Ui: Entity | undefined = Instance.FindEntityByName(ClassUiName);
	if (IsCustomHudLayout(Ui))
	{
		return Ui;
	}
	if (!GbWarnedNoClassUi)
	{
		GbWarnedNoClassUi = true;
		const Problem: string = Ui ? "exists but isn't a custom_hud_layout" : "wasn't found";
		Console.Log(`${LogPrefix} problem finding "${ClassUiName}" ${Problem}. check custom_hud_layout entity`);
	}
	return undefined;
}

function IsCustomHudLayout(Ent: Entity | undefined): Ent is CustomHudLayout
{
	return Ent !== undefined && "SetInputCaptureEnabled" in Ent && typeof Ent.SetInputCaptureEnabled === "function";
}