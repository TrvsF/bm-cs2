import { Instance } from "cs_script/point_script";
import type
{
	Entity,
	CSPlayerPawn,
	CSPlayerController,
	CSWeaponBase,
	CSWeaponData,
	PointTemplate,
	Vector,
	QAngle,
	ColorArg,
} from "cs_script/point_script";

export const bDebug: boolean = true;
export const TickInterval: number = 1 / 64;

// Types ///////////////////////////////////////////////////////////////////////////////////////////

export type FVector = Vector;
export type FRotator = QAngle;
export type FColor = ColorArg;

// Pulls the event struct out of an Instance.OnXxx(Callback) binder, so these never drift from Valve's typings
type TEventOf<TBinder> = TBinder extends (Callback: infer TCallback) => void
	? TCallback extends (Event: infer TEvent) => unknown ? TEvent : never
	: never;

export type FPlayerChatEvent = TEventOf<typeof Instance.OnPlayerChat>;
export type FPlayerResetEvent = TEventOf<typeof Instance.OnPlayerReset>;
export type FPlayerKillEvent = TEventOf<typeof Instance.OnPlayerKill>;
export type FPlayerDisconnectEvent = TEventOf<typeof Instance.OnPlayerDisconnect>;
export type FGunFireEvent = TEventOf<typeof Instance.OnGunFire>;
export type FPlayerDamageEvent = TEventOf<typeof Instance.OnPlayerDamage>;
export type FModifyDamageEvent = TEventOf<typeof Instance.OnModifyPlayerDamage>;
export type FModifyDamageResult = ReturnType<Parameters<typeof Instance.OnModifyPlayerDamage>[0]>;

enum ETeam
{
	Unassigned = 0,
	Spectator = 1,
	Terrorist = 2,
	CounterTerrorist = 3,
}

interface FPendingTimer
{
	FireTime: number;
	Callback: () => void;
}

// Data ////////////////////////////////////////////////////////////////////////////////////////////

export const INDEX_NONE: number = -1;
export const LogPrefix: string = "[BM]";
const MaxPlayerSlots: number = 64;

export const UpVector: FVector = { x: 0, y: 0, z: 1 };
export const ZeroVector: FVector = { x: 0, y: 0, z: 0 };
const ChestOffset: FVector = { x: 0, y: 0, z: 40 };

const TerroristColor: FColor = { r: 220, g: 60, b: 50 };
const CounterTerroristColor: FColor = { r: 70, g: 130, b: 230 };

const GPendingTimers: FPendingTimer[] = [];

// Timers //////////////////////////////////////////////////////////////////////////////////////////

export function SetTimer(Delay: number, Callback: () => void): void
{
	GPendingTimers.push({ FireTime: Instance.GetGameTime() + Delay, Callback });
}

export function TickTimers(Now: number): void
{
	for (let Index: number = GPendingTimers.length - 1; Index >= 0; Index--)
	{
		const Timer: FPendingTimer | undefined = GPendingTimers[Index];
		if (Timer && Timer.FireTime <= Now)
		{
			GPendingTimers.splice(Index, 1);
			Timer.Callback();
		}
	}
}

// Util ///////////////////////////////////////////////////////////////////////////////////////////

export abstract class FVectorMath
{
	public static Add(A: FVector, B: FVector): FVector
	{
		return { x: A.x + B.x, y: A.y + B.y, z: A.z + B.z };
	}

	public static Subtract(A: FVector, B: FVector): FVector
	{
		return { x: A.x - B.x, y: A.y - B.y, z: A.z - B.z };
	}

	public static Scale(V: FVector, Scalar: number): FVector
	{
		return { x: V.x * Scalar, y: V.y * Scalar, z: V.z * Scalar };
	}

	public static Size(V: FVector): number
	{
		return Math.hypot(V.x, V.y, V.z);
	}

	public static GetSafeNormal(V: FVector): FVector
	{
		const Length: number = Math.hypot(V.x, V.y, V.z) || 1;
		return { x: V.x / Length, y: V.y / Length, z: V.z / Length };
	}

	public static GetForwardVector(Rotation: FRotator): FVector
	{
		const Pitch: number = (Rotation.pitch * Math.PI) / 180;
		const Yaw: number = (Rotation.yaw * Math.PI) / 180;
		return { x: Math.cos(Pitch) * Math.cos(Yaw), y: Math.cos(Pitch) * Math.sin(Yaw), z: -Math.sin(Pitch) };
	}

	// The rotation whose forward vector points along Direction (the inverse of GetForwardVector)
	public static GetRotation(Direction: FVector, Roll: number = 0): FRotator
	{
		const Normal: FVector = FVectorMath.GetSafeNormal(Direction);
		const Pitch: number = (-Math.asin(Math.max(-1, Math.min(1, Normal.z))) * 180) / Math.PI;
		const Yaw: number = (Math.atan2(Normal.y, Normal.x) * 180) / Math.PI;
		return { pitch: Pitch, yaw: Yaw, roll: Roll };
	}
}

export function IsValid<TEntity extends Entity>(Ent: TEntity | undefined): Ent is TEntity
{
	return Ent !== undefined && Ent.IsValid();
}

export function IsPlayerPawn(Ent: Entity | undefined): Ent is CSPlayerPawn
{
	return Ent !== undefined
		&& "GetPlayerController" in Ent && typeof Ent.GetPlayerController === "function"
		&& "IsInputPressed" in Ent && typeof Ent.IsInputPressed === "function";
}

export function IsPointTemplate(Ent: Entity | undefined): Ent is PointTemplate
{
	return Ent !== undefined && "ForceSpawn" in Ent && typeof Ent.ForceSpawn === "function";
}

export function GetChestPosition(Pawn: CSPlayerPawn): FVector
{
	return FVectorMath.Add(Pawn.GetAbsOrigin(), ChestOffset);
}

export function GetTeamColor(Ent: Entity): FColor
{
	return Ent.GetTeamNumber() === ETeam.Terrorist ? TerroristColor : CounterTerroristColor;
}

export function GetPlayerSlot(Ent: Entity | undefined): number
{
	if (!IsPlayerPawn(Ent))
	{
		return INDEX_NONE;
	}
	const Controller: CSPlayerController | undefined = Ent.GetPlayerController();
	return Controller ? Controller.GetPlayerSlot() : INDEX_NONE;
}

export function IsWeapon(Weapon: CSWeaponBase | undefined, Name: string): boolean
{
	if (!Weapon)
	{
		return false;
	}
	if (Weapon.GetClassName() === Name)
	{
		return true;
	}
	const Data: CSWeaponData | undefined = Weapon.GetData();
	return Data !== undefined && Data.GetName() === Name;
}

export function SpawnFromTemplate(TemplateName: string, Position: FVector): Entity | undefined
{
	const Template: Entity | undefined = Instance.FindEntityByName(TemplateName);
	if (!IsPointTemplate(Template))
	{
		return undefined;
	}
	const Spawned: Entity[] | undefined = Template.ForceSpawn(Position);
	return Spawned ? Spawned[0] : undefined;
}

export function ForEachLivePawn(Visitor: (Pawn: CSPlayerPawn, Slot: number) => void): void
{
	for (let Slot: number = 0; Slot < MaxPlayerSlots; Slot++)
	{
		const Controller: CSPlayerController | undefined = Instance.GetPlayerController(Slot);
		if (!Controller)
		{
			continue;
		}
		const Pawn: CSPlayerPawn | undefined = Controller.GetPlayerPawn();
		if (IsValid(Pawn) && Pawn.IsAlive())
		{
			Visitor(Pawn, Slot);
		}
	}
}
