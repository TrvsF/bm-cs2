import { Instance } from "cs_script/point_script";
import type { Entity, CustomHudLayout } from "cs_script/point_script";
import { LogPrefix, SetTimer } from "./bm_core";

// Types ///////////////////////////////////////////////////////////////////////////////////////////

interface FDamageNumberState
{
	DamageTotal: number;
	LastDamageTime: number;
	bDamagePopA: boolean;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

const DamageHudName: string = "damage_hud";
const DamageLabelId: string = "DamageNumber";
const DamageBatchWindow: number = 0.6;
const DamageShowTime: number = 0.85;

const GDamageNumberStates: Map<number, FDamageNumberState> = new Map<number, FDamageNumberState>();
let GbWarnedNoDamageHud: boolean = false;

// Hud /////////////////////////////////////////////////////////////////////////////////////////////

export function ShowDamageNumber(Slot: number, Damage: number): void
{
	const Hud: CustomHudLayout | undefined = FindDamageHud();
	if (!Hud || Damage <= 0)
	{
		return;
	}

	const State: FDamageNumberState = GetDamageNumberState(Slot);
	const Now: number = Instance.GetGameTime();
	if (Now - State.LastDamageTime > DamageBatchWindow)
	{
		State.DamageTotal = 0;
	}
	State.DamageTotal += Damage;
	State.LastDamageTime = Now;

	State.bDamagePopA = !State.bDamagePopA;
	Hud.SetDialogVariableStringForPlayer(Slot, DamageLabelId, "damage", `-${Math.round(State.DamageTotal)}`);

	SetTimer(DamageShowTime, (): void =>
	{
		const LaterHud: CustomHudLayout | undefined = FindDamageHud();
		if (LaterHud && Instance.GetGameTime() - State.LastDamageTime >= DamageShowTime - 0.01)
		{
			LaterHud.SetDialogVariableStringForPlayer(Slot, DamageLabelId, "damage", "");
		}
	});
}

export function ResetDamageNumbers(Slot: number): void
{
	GDamageNumberStates.delete(Slot);
	const Hud: CustomHudLayout | undefined = FindDamageHud();
	if (Hud)
	{
		Hud.ResetForPlayer(Slot);
	}
}

function GetDamageNumberState(Slot: number): FDamageNumberState
{
	let State: FDamageNumberState | undefined = GDamageNumberStates.get(Slot);
	if (!State)
	{
		State = { DamageTotal: 0, LastDamageTime: 0, bDamagePopA: false };
		GDamageNumberStates.set(Slot, State);
	}
	return State;
}

function FindDamageHud(): CustomHudLayout | undefined
{
	const Hud: Entity | undefined = Instance.FindEntityByName(DamageHudName);
	if (IsCustomHudLayout(Hud))
	{
		return Hud;
	}
	if (!GbWarnedNoDamageHud)
	{
		GbWarnedNoDamageHud = true;
		const Problem: string = Hud ? "exists but isn't a custom_hud_layout" : "wasn't found";
		Instance.Msg(`${LogPrefix} damage numbers: an entity named "${DamageHudName}" ${Problem}. Check the custom_hud_layout in Hammer, then do a full map build.`);
	}
	return undefined;
}

function IsCustomHudLayout(Ent: Entity | undefined): Ent is CustomHudLayout
{
	return Ent !== undefined && "SetDialogVariableStringForPlayer" in Ent && typeof Ent.SetDialogVariableStringForPlayer === "function";
}
