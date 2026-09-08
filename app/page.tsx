"use client";

import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LogOut, ShieldCheck, Wallet, PlusCircle, MinusCircle, CalendarDays, BarChart3, Check, Trash2, ChevronRight, ArrowLeft, Camera, KeyRound, UserPlus, Users, ArrowLeftRight, Plus, ArrowDownLeft, ArrowUpRight, Receipt, X } from "lucide-react";
import { motion } from "framer-motion";

type User = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "dev" | "user";
  balance: number;
  avatar: string;
};

type AddMoneyFormState = {
  selectedUserIds: string[];
  amount: string;
  message: string;
  fixedChargeId: string;
};

type RideScheduleItem = {
  id: string;
  season: string;
  match_date: string;
  team: string;
  location: "uit" | "thuis";
  kilometers: number | null;
  riders: string[];
};

// De verantwoordelijken voor het materiaal, per maand van het seizoen.
type MaterialDutyItem = {
  season: string;
  month: number;
  persons: string[];
};

type FinanceCategory = "saldo" | "boete" | "vaste_lasten";

type Transaction = {
  id: string;
  created_at: string;
  user_id: string;
  name: string;
  amount_change: number;
  category: FinanceCategory;
  season: string;
  fixed_charge_id: string | null;
};

// Een vaste lasten post: elke seizoenshelft maakt de admin er een aan.
type FixedCharge = {
  id: string;
  created_at: string;
  name: string;
};

type AvatarCacheMap = Record<string, string>;
type AppEventType = "login" | "logout" | "session_resume";
type TrackedAppEventType = "login" | "session_resume";
type AppEvent = {
  id: string;
  created_at: string;
  user_id: string | null;
  event_type: AppEventType;
};
type EventAggregation = "hour" | "day" | "week" | "month";
type StatsKpiKey = "count" | "total" | "average" | "largest";
type TransactionDirection = "alle" | "bij" | "af";

const homeTeamName = "HC Den Bosch H6";

function euro(amount: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(amount);
}

function getRideScheduleMatchTitle(match: RideScheduleItem) {
  const opponent = match.team || "Tegenstander";
  return match.location === "uit" ? `${opponent} - ${homeTeamName}` : `${homeTeamName} - ${opponent}`;
}

const shortMonths = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

// Supabase levert een date kolom als "YYYY-MM-DD": tekstueel splitsen voorkomt tijdzoneverschuiving.
function getRideScheduleDateParts(matchDate: string) {
  const [, month, day] = matchDate.split("-");
  return { day: day ? String(Number(day)) : matchDate, month: shortMonths[Number(month) - 1] ?? "" };
}

// Zowel het rijschema als de materiaalsletjes noemen mensen bij voornaam.
function isCurrentUserNamed(name: string, user: User | null) {
  if (!user) return false;
  const normalize = (value: string) => value.trim().toLowerCase();
  const listedName = normalize(name);
  const fullName = normalize(user.name);
  return listedName === normalize(user.username) || listedName === fullName || listedName === fullName.split(" ")[0];
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).map((part) => part[0]?.toUpperCase()).join("").slice(0, 2);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const authEmailDomain = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? "saldo.local";
const avatarBucket = process.env.NEXT_PUBLIC_SUPABASE_AVATAR_BUCKET ?? "avatars";
const pullRefreshMinimumDurationMs = 650;
const allTimeSeasonValue = "alle";
const allUsersValue = "alle";
const transactionPageSize = 30;

const statsKpiDetailTitles: Record<StatsKpiKey, { title: string; description: string }> = {
  count: { title: "Vaakst opgewaardeerd", description: "Top 5 op aantal opwaarderingen." },
  total: { title: "Meest opgewaardeerd", description: "Top 5 op totaal opgewaardeerd bedrag." },
  average: { title: "Verdeling van opwaarderingen", description: "Hoe vaak elk bedrag is opgewaardeerd." },
  largest: { title: "Grootste opwaardeerders", description: "Top 5 op grootste losse opwaardering." },
};

const transactionDirectionOptions: Array<{ value: TransactionDirection; label: string }> = [
  { value: "alle", label: "Alle" },
  { value: "bij", label: "Bij" },
  { value: "af", label: "Af" },
];

const financeCategoryOptions: Array<{ value: FinanceCategory; label: string }> = [
  { value: "saldo", label: "Saldo" },
  { value: "boete", label: "Boetes" },
  { value: "vaste_lasten", label: "Vaste lasten" },
];

// Het grote bedrag op de KPI-kaart: de centen lichter, zoals in een bank-app.
function splitEuro(amount: number) {
  const formatted = euro(amount);
  const separatorIndex = formatted.lastIndexOf(",");
  if (separatorIndex === -1) return { main: formatted, cents: "" };
  return { main: formatted.slice(0, separatorIndex), cents: formatted.slice(separatorIndex) };
}

function getTransactionKindLabel(transaction: Transaction) {
  if (transaction.category === "boete") return "Boete";
  if (transaction.category === "vaste_lasten") return transaction.user_id ? "Betaling" : "Uitgave uit de pot";
  return transaction.amount_change >= 0 ? "Opwaardering" : "Uitgave";
}

// Een seizoen loopt van 1 augustus t/m 31 juli: augustus 2026 t/m juli 2027 hoort bij "2026-2027".
const seasonStartMonth = 7;

function getSeasonForDate(date: Date | string) {
  const value = typeof date === "string" ? new Date(date) : date;
  const startYear = value.getMonth() >= seasonStartMonth ? value.getFullYear() : value.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

function getCurrentSeason() {
  return getSeasonForDate(new Date());
}

// Tijdelijk hardcoded tot de materiaalsletjes uit Supabase komen.
// December en januari staan er bewust niet in: die maanden is er geen indeling.
const materialDuties: MaterialDutyItem[] = [
  { season: "2026-2027", month: 9, persons: ["joost", "thomas", "tom"] },
  { season: "2026-2027", month: 10, persons: ["pieter", "bas"] },
  { season: "2026-2027", month: 11, persons: ["jonathan", "juriaan", "sewi"] },
  { season: "2026-2027", month: 2, persons: ["tim", "matthijs", "sam"] },
  { season: "2026-2027", month: 3, persons: ["tim", "matthijs", "sam"] },
  { season: "2026-2027", month: 4, persons: ["timon", "pepijn"] },
  { season: "2026-2027", month: 5, persons: ["hugo", "tijn"] },
  { season: "2026-2027", month: 6, persons: ["olivier", "brek"] },
];

// Augustus t/m december horen bij het eerste kalenderjaar van het seizoen, januari t/m juli bij het tweede.
function getMaterialDutyYear(season: string, month: number) {
  const [startYear, endYear] = season.split("-");
  return month > seasonStartMonth ? startYear : endYear;
}

// Sorteren op seizoensvolgorde: augustus voorop, juli achteraan.
function getMaterialDutyMonthOrder(month: number) {
  return (month - seasonStartMonth - 1 + 12) % 12;
}

function sanitizeUsername(username: string) {
  return username.trim().toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 48);
}

function usernameToAuthEmail(username: string) {
  return `${sanitizeUsername(username)}@${authEmailDomain}`;
}

async function resizeAvatar(dataUrl: string) {
  const image = new Image();
  image.src = dataUrl;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Avatar afbeelding kon niet worden geladen."));
  });

  const maxSize = 1024;
  const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/webp", 0.92);
}

async function dataUrlToBlob(dataUrl: string) {
  return (await fetch(dataUrl)).blob();
}

function isExternalAvatarUrl(value: string) { return /^https?:\/\//.test(value); }
function isDataUrlAvatar(value: string) { return value.startsWith("data:image/"); }
function isStorageAvatarPath(value: string) { return Boolean(value) && !isExternalAvatarUrl(value) && !isDataUrlAvatar(value); }

function avatarValueToSrc(value: string) {
  if (!value) return "";
  if (isExternalAvatarUrl(value) || isDataUrlAvatar(value)) return value;
  return supabase.storage.from(avatarBucket).getPublicUrl(value).data.publicUrl;
}

function buildAvatarObjectPath(userId: string) { return `users/${userId}/avatar-${Date.now()}.webp`; }
function isDefined<T>(value: T | undefined): value is T { return value !== undefined; }
function isAdmin(role: User["role"]) { return role === "admin"; }
function isDev(role: User["role"]) { return role === "dev"; }
function getRoleLabel(role: User["role"]) {
  if (role === "admin") return "Admin";
  if (role === "dev") return "Dev";
  return "Gebruiker";
}

function getWeekStart(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const diff = (day + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  return copy;
}

function getBucketStart(dateString: string, aggregation: EventAggregation) {
  const date = new Date(dateString);
  if (aggregation === "hour") {
    date.setMinutes(0, 0, 0);
    return date;
  }
  if (aggregation === "day") {
    date.setHours(0, 0, 0, 0);
    return date;
  }
  if (aggregation === "week") return getWeekStart(date);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatEventBucketLabel(bucketStart: Date, aggregation: EventAggregation) {
  if (aggregation === "hour") {
    return new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(bucketStart);
  }
  if (aggregation === "day") {
    return new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit" }).format(bucketStart);
  }
  if (aggregation === "week") {
    const weekEnd = new Date(bucketStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const formatter = new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit" });
    return `${formatter.format(bucketStart)} - ${formatter.format(weekEnd)}`;
  }
  return new Intl.DateTimeFormat("nl-NL", { month: "short", year: "numeric" }).format(bucketStart);
}

const eventAggregationOptions: Array<{ value: EventAggregation; label: string }> = [
  { value: "hour", label: "Uur" },
  { value: "day", label: "Dag" },
  { value: "week", label: "Week" },
  { value: "month", label: "Maand" },
];

const trackedEventTypes: TrackedAppEventType[] = ["login", "session_resume"];

const UserAvatar = React.memo(function UserAvatar({ name, avatar, className, fallbackClassName }: {
  name: string; avatar: string; className?: string; fallbackClassName?: string;
}) {
  return (
    <Avatar className={className}>
      {avatar ? <AvatarImage src={avatar} alt={name} loading="lazy" decoding="async" /> : null}
      <AvatarFallback className={fallbackClassName}>{getInitials(name)}</AvatarFallback>
    </Avatar>
  );
});

const UsageLineChart = React.memo(function UsageLineChart({
  points,
}: {
  points: Array<{ key: string; label: string; value: number }>;
}) {
  const width = 640;
  const height = 240;
  const paddingX = 48;
  const paddingTop = 18;
  const paddingBottom = 38;
  const graphHeight = height - paddingTop - paddingBottom;
  const graphWidth = width - paddingX * 2;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const tickValues = Array.from(new Set([0, Math.ceil(maxValue / 2), maxValue])).sort((a, b) => a - b);

  const pointCoordinates = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : paddingX + (index / (points.length - 1)) * graphWidth;
    const y = paddingTop + graphHeight - (point.value / maxValue) * graphHeight;
    return { ...point, x, y };
  });

  const createSmoothPath = (coordinates: typeof pointCoordinates) => {
    if (coordinates.length === 0) return "";
    if (coordinates.length === 1) return `M ${coordinates[0].x} ${coordinates[0].y}`;

    let result = `M ${coordinates[0].x} ${coordinates[0].y}`;
    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const current = coordinates[index];
      const next = coordinates[index + 1];
      const controlX = (current.x + next.x) / 2;
      result += ` C ${controlX} ${current.y}, ${controlX} ${next.y}, ${next.x} ${next.y}`;
    }
    return result;
  };

  const path = createSmoothPath(pointCoordinates);
  const areaPath = path
    ? `${path} L ${pointCoordinates[pointCoordinates.length - 1].x} ${paddingTop + graphHeight} L ${pointCoordinates[0].x} ${paddingTop + graphHeight} Z`
    : "";
  const visibleLabelIndexes = points.length <= 6
    ? points.map((_, index) => index)
    : Array.from(new Set([0, Math.floor((points.length - 1) / 3), Math.floor(((points.length - 1) * 2) / 3), points.length - 1]));

  return (
    <div className="space-y-3">
      <div className="h-64 w-full rounded-xl border border-slate-200 bg-white p-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label="Gebruiksstatistieken grafiek">
          {tickValues.map((tick) => {
            const y = paddingTop + graphHeight - (tick / maxValue) * graphHeight;
            return <text key={tick} x={paddingX - 10} y={y + 7} textAnchor="end" fontSize="18" fill="#0f172a">{tick}</text>;
          })}

          <path d={areaPath} fill="rgba(60, 71, 89, 0.18)" />
          <path d={path} fill="none" stroke="#3c4759" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />

          {pointCoordinates.map((point) => (
            <g key={point.key}>
              <circle cx={point.x} cy={point.y} r="4.5" fill="#3c4759" />
              <circle cx={point.x} cy={point.y} r="9" fill="transparent">
                <title>{`${point.label}: ${point.value}`}</title>
              </circle>
            </g>
          ))}

          {visibleLabelIndexes.map((index) => {
            const point = pointCoordinates[index];
            const isFirst = index === 0;
            const isLast = index === pointCoordinates.length - 1;
            return (
              <text
                key={point.key}
                x={point.x}
                y={height - 6}
                textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
                fontSize="17"
                fill="#0f172a"
              >
                {point.label}
              </text>
            );
          })}
        </svg>
      </div>
      <p className="text-xs text-slate-500"> </p>
    </div>
  );
});

export default function SaldoTrackerApp() {
  const [avatarCache, setAvatarCache] = useState<AvatarCacheMap>({});
  const [users, setUsers] = useState<User[]>([]);
  const [appEvents, setAppEvents] = useState<AppEvent[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [lastDataRefreshAt, setLastDataRefreshAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<"saldo" | "rijschema" | "statistieken">("saldo");
  const [activeFinanceCategory, setActiveFinanceCategory] = useState<FinanceCategory>("saldo");
  const [fixedCharges, setFixedCharges] = useState<FixedCharge[]>([]);
  const [selectedFixedChargeId, setSelectedFixedChargeId] = useState<string | null>(null);
  const [fixedChargeForm, setFixedChargeForm] = useState({ name: "", message: "" });
  const [isSavingFixedCharge, setIsSavingFixedCharge] = useState(false);
  const [deletingFixedChargeId, setDeletingFixedChargeId] = useState<string | null>(null);
  const [isFixedChargeModalOpen, setIsFixedChargeModalOpen] = useState(false);
  const [potPaymentForm, setPotPaymentForm] = useState({ amount: "", message: "" });
  const [isSavingPotPayment, setIsSavingPotPayment] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(getCurrentSeason);
  const [rideScheduleItems, setRideScheduleItems] = useState<RideScheduleItem[]>([]);
  const [selectedRideSeason, setSelectedRideSeason] = useState(getCurrentSeason);
  const [activeSaldoTab, setActiveSaldoTab] = useState<"overzicht" | "transacties" | "toevoegen">("overzicht");
  const [saldoTransactionUserFilter, setSaldoTransactionUserFilter] = useState(allUsersValue);
  const [saldoTransactionSeasonFilter, setSaldoTransactionSeasonFilter] = useState(allTimeSeasonValue);
  const [saldoTransactionDirectionFilter, setSaldoTransactionDirectionFilter] = useState<TransactionDirection>("alle");
  const [addMoneyForm, setAddMoneyForm] = useState<AddMoneyFormState>({ selectedUserIds: [], amount: "", message: "", fixedChargeId: "" });
  const [isProfilePageOpen, setIsProfilePageOpen] = useState(false);
  const [transactionPaging, setTransactionPaging] = useState({ listKey: "", limit: transactionPageSize });
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPasswordForChange, setCurrentPasswordForChange] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [expandedStatMonths, setExpandedStatMonths] = useState<string[]>([]);
  const [expandedStatDates, setExpandedStatDates] = useState<string[]>([]);
  const [selectedStatsSeason, setSelectedStatsSeason] = useState<string | null>(null);
  const [activeStatsKpi, setActiveStatsKpi] = useState<StatsKpiKey | null>(null);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [addUserForm, setAddUserForm] = useState({ username: "", name: "", password: "" });
  const [addUserMessage, setAddUserMessage] = useState("");
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [eventAggregation, setEventAggregation] = useState<EventAggregation>("day");
  const [excludeJoostEvents, setExcludeJoostEvents] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const userModalRef = useRef<HTMLDivElement | null>(null);
  const refreshUsersPromiseRef = useRef<Promise<void> | null>(null);
  const avatarCacheRef = useRef<AvatarCacheMap>(avatarCache);
  const isFetchingAvatarsRef = useRef(false);
  const liveRefreshTimeoutRef = useRef<number | null>(null);
  const pendingAvatarRefreshRef = useRef(false);
  const isLoggedInRef = useRef(false);
  const touchStartYRef = useRef(0);
  const isPullingRef = useRef(false);
  const hasLoggedSessionResumeRef = useRef(false);

  const mergeUserWithAvatarCache = (user: User) => ({ ...user, avatar: user.avatar || avatarCacheRef.current[user.id] || "" });
  const getAvatarForUser = (user: Pick<User, "id" | "avatar">) => avatarCache[user.id] || avatarValueToSrc(user.avatar);

  const setAvatarCacheEntries = (entries: AvatarCacheMap) => {
    const nextCache = { ...avatarCacheRef.current, ...entries };
    avatarCacheRef.current = nextCache;
    setAvatarCache(nextCache);
  };

  const updateAvatarCacheForUser = (userId: string, avatarValue: string) => {
    const nextCache = { ...avatarCacheRef.current };
    const avatarSrc = avatarValueToSrc(avatarValue);
    if (avatarSrc) { nextCache[userId] = avatarSrc; } else { delete nextCache[userId]; }
    avatarCacheRef.current = nextCache;
    setAvatarCache(nextCache);
  };

  const removeAvatarObject = async (avatarValue: string) => {
    if (!isStorageAvatarPath(avatarValue)) return;
    const { error } = await supabase.storage.from(avatarBucket).remove([avatarValue]);
    if (error) console.error("Fout bij verwijderen avatarbestand:", error);
  };

  const logAppEvent = async (userId: string, eventType: AppEventType) => {
    const { error } = await supabase.from("app_events").insert({ user_id: userId, event_type: eventType });
    if (error) console.error(`Fout bij loggen app event (${eventType}):`, error);
  };

  const resetAuthState = () => {
    isLoggedInRef.current = false;
    hasLoggedSessionResumeRef.current = false;
    setAppEvents([]);
    setCurrentUser(null);
    setUsers([]);
    setTransactions([]);
    setFixedCharges([]);
  };

  const syncSessionState = async (
    session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"],
    { logSessionResume = false }: { logSessionResume?: boolean } = {},
  ) => {
    if (!session?.user?.id) {
      resetAuthState();
      setIsAuthLoading(false);
      return;
    }

    const profile = await loadCurrentUser(session.user.id);
    if (profile) {
      isLoggedInRef.current = true;
      if (logSessionResume && !hasLoggedSessionResumeRef.current) {
        hasLoggedSessionResumeRef.current = true;
        await logAppEvent(profile.id, "session_resume");
      }
      await refreshUsers({ force: true, includeAppEvents: isDev(profile.role) });
      setError("");
    } else {
      await supabase.auth.signOut({ scope: "local" });
    }

    setIsAuthLoading(false);
  };

  const loadCurrentUser = async (userId: string) => {
    const { data, error: currentUserError } = await supabase
      .from("users").select("id, username, name, role, balance, avatar").eq("id", userId).maybeSingle();
    if (currentUserError) { console.error("Fout bij ophalen huidige gebruiker:", currentUserError); return null; }
    if (!data) { console.error("Geen profiel gevonden voor auth gebruiker."); return null; }
    const userWithAvatar = mergeUserWithAvatarCache(data);
    setCurrentUser(userWithAvatar);
    if (data.avatar) updateAvatarCacheForUser(data.id, data.avatar);
    return userWithAvatar;
  };

  const refreshUsers = async ({ force = false, includeAppEvents }: { force?: boolean; includeAppEvents?: boolean } = {}) => {
    if (refreshUsersPromiseRef.current) return refreshUsersPromiseRef.current;

    const refreshPromise = (async () => {
      const { data, error } = await supabase.from("users").select("id, username, name, role, balance");
      if (error) { console.error("Fout bij verversen users:", error); return; }
      if (data) setUsers(data.map((user) => mergeUserWithAvatarCache({ ...user, avatar: "" })));

      const transactionColumns = "id, created_at, user_id, name, amount_change, category, season";
      const withFixedCharge = await supabase
        .from("transactions").select(`${transactionColumns}, fixed_charge_id`).order("created_at", { ascending: false });
      // Zolang setup-vaste-lasten.sql nog niet gedraaid is bestaat fixed_charge_id nog niet.
      const { data: transactionData, error: transactionError } = withFixedCharge.error
        ? await supabase.from("transactions").select(transactionColumns).order("created_at", { ascending: false })
        : withFixedCharge;
      if (transactionError) { console.error("Fout bij ophalen transacties:", transactionError); return; }
      if (transactionData) setTransactions(transactionData.map((transaction) => ({ fixed_charge_id: null, ...transaction })));

      const { data: fixedChargeData, error: fixedChargeError } = await supabase
        .from("fixed_charges").select("id, created_at, name").order("created_at", { ascending: false });
      if (fixedChargeError) {
        console.error("Fout bij ophalen vaste lasten:", fixedChargeError);
      } else if (fixedChargeData) {
        setFixedCharges(fixedChargeData);
      }
      const { data: rideScheduleData, error: rideScheduleError } = await supabase
        .from("ride_schedule").select("id, season, match_date, team, location, kilometers, riders").order("match_date", { ascending: true });
      if (rideScheduleError) {
        console.error("Fout bij ophalen rijschema:", rideScheduleError);
      } else if (rideScheduleData) {
        setRideScheduleItems(rideScheduleData.map((item) => ({ ...item, riders: item.riders ?? [] })));
      }

      const shouldLoadAppEvents = includeAppEvents ?? Boolean(currentUser && isDev(currentUser.role));
      if (shouldLoadAppEvents) {
        const { data: appEventData, error: appEventError } = await supabase
          .from("app_events")
          .select("id, created_at, user_id, event_type")
          .in("event_type", trackedEventTypes)
          .order("created_at", { ascending: true });
        if (appEventError) {
          console.error("Fout bij ophalen app events:", appEventError);
        } else if (appEventData) {
          setAppEvents(appEventData);
        }
      }
      setLastDataRefreshAt(new Date().toISOString());
    })();

    refreshUsersPromiseRef.current = refreshPromise;
    try { await refreshPromise; } finally { refreshUsersPromiseRef.current = null; }
  };

  const refreshAvatarCache = async ({ userIds, force = false }: { userIds?: string[]; force?: boolean } = {}) => {
    if (isFetchingAvatarsRef.current) return;
    const targetUserIds = userIds?.filter(isDefined) ??
      Array.from(new Set([currentUser?.id, ...users.map((u) => u.id)].filter(isDefined)));
    if (targetUserIds.length === 0) return;
    const missingUserIds = force ? targetUserIds : targetUserIds.filter((id) => !(id in avatarCacheRef.current));
    if (missingUserIds.length === 0) return;
    isFetchingAvatarsRef.current = true;
    try {
      const { data, error } = await supabase.from("users").select("id, avatar").in("id", missingUserIds);
      if (error) { console.error("Fout bij ophalen avatars:", error); return; }
      const nextCache = (data ?? []).reduce<AvatarCacheMap>((acc, user) => {
        if (user.avatar) acc[user.id] = avatarValueToSrc(user.avatar);
        return acc;
      }, {});
      setAvatarCacheEntries(nextCache);
    } finally { isFetchingAvatarsRef.current = false; }
  };

  useEffect(() => {
    if (!currentUser) return;
    void refreshAvatarCache({ userIds: [currentUser.id] });
  }, [currentUser]);

  useEffect(() => {
    if (users.length === 0) return;
    void refreshAvatarCache({ userIds: users.map((u) => u.id) });
  }, [users]);

  useEffect(() => {
    function handleClickOutsideModal(event: MouseEvent) {
      if (userModalRef.current && !userModalRef.current.contains(event.target as Node)) setSelectedUser(null);
    }
    if (selectedUser) document.addEventListener("mousedown", handleClickOutsideModal);
    return () => document.removeEventListener("mousedown", handleClickOutsideModal);
  }, [selectedUser]);

  // Auth via onAuthStateChange — enkel systeem, geen bootstrapSession
  useEffect(() => {
    let isMounted = true;

    const handleSessionChange = async (
      session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"],
      logSessionResume = false,
    ) => {
      if (!isMounted) return;
      try {
        await syncSessionState(session, { logSessionResume });
      } catch (authError) {
        console.error("Fout tijdens synchroniseren auth status:", authError);
        if (isMounted) {
          resetAuthState();
          setError("Inloggen herstellen mislukt. Probeer opnieuw.");
          setIsAuthLoading(false);
        }
      }
    };

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!isMounted) return;
      if (sessionError) {
        console.error("Fout bij ophalen huidige sessie:", sessionError);
        resetAuthState();
        setIsAuthLoading(false);
        return;
      }
      void handleSessionChange(data.session, Boolean(data.session));
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        if (!isMounted) return;
        void handleSessionChange(session);
      }, 0);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Pull-to-refresh
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0].clientY;
      isPullingRef.current = window.scrollY === 0;
    };

    const handleTouchEnd = async (e: TouchEvent) => {
      if (!isPullingRef.current || !isLoggedInRef.current) return;
      const pullDistance = e.changedTouches[0].clientY - touchStartYRef.current;
      if (pullDistance > 80) {
        setIsPullRefreshing(true);
        await Promise.all([
          refreshUsers({ force: true }),
          wait(pullRefreshMinimumDurationMs),
        ]);
        setIsPullRefreshing(false);
      }
      isPullingRef.current = false;
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, []);

  // Realtime Supabase updates
  useEffect(() => {
    if (!currentUser) return;

    const scheduleRealtimeRefresh = (includeAvatars = false) => {
      if (includeAvatars) pendingAvatarRefreshRef.current = true;
      if (liveRefreshTimeoutRef.current) window.clearTimeout(liveRefreshTimeoutRef.current);
      liveRefreshTimeoutRef.current = window.setTimeout(async () => {
        const shouldRefreshAvatars = pendingAvatarRefreshRef.current;
        pendingAvatarRefreshRef.current = false;
        liveRefreshTimeoutRef.current = null;
        await refreshUsers({ force: true });
        if (shouldRefreshAvatars) await refreshAvatarCache({ force: true });
      }, 300);
    };

    const channel = supabase
      .channel(`saldo-live-${currentUser.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => scheduleRealtimeRefresh(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => scheduleRealtimeRefresh(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "fixed_charges" }, () => scheduleRealtimeRefresh(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_schedule" }, () => scheduleRealtimeRefresh(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "app_events" }, () => {
        if (isDev(currentUser.role)) scheduleRealtimeRefresh(false);
      })
      .subscribe();

    return () => {
      pendingAvatarRefreshRef.current = false;
      if (liveRefreshTimeoutRef.current) { window.clearTimeout(liveRefreshTimeoutRef.current); liveRefreshTimeoutRef.current = null; }
      void supabase.removeChannel(channel);
    };
  }, [currentUser]);

  const sortedUsers = useMemo(() => [...users].filter((u) => !isAdmin(u.role)).sort((a, b) => b.balance - a.balance), [users]);
  const saldoTransactions = useMemo(() => transactions.filter((transaction) => transaction.category === "saldo"), [transactions]);
  const boeteTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.category === "boete" && transaction.season === selectedSeason),
    [selectedSeason, transactions],
  );
  const availableSeasons = useMemo(() => {
    const seasons = new Set<string>([getCurrentSeason()]);
    for (const transaction of transactions) {
      if (transaction.category === "boete") seasons.add(transaction.season);
    }
    return Array.from(seasons).sort((a, b) => b.localeCompare(a));
  }, [transactions]);
  const rideScheduleSeasons = useMemo(() => {
    const seasons = new Set<string>([getCurrentSeason()]);
    for (const match of rideScheduleItems) seasons.add(match.season);
    return Array.from(seasons).sort((a, b) => b.localeCompare(a));
  }, [rideScheduleItems]);
  const rideSchedule = useMemo(
    () => rideScheduleItems.filter((match) => match.season === selectedRideSeason),
    [rideScheduleItems, selectedRideSeason],
  );
  const materialDuty = useMemo(
    () => materialDuties
      .filter((duty) => duty.season === selectedRideSeason)
      .sort((a, b) => getMaterialDutyMonthOrder(a.month) - getMaterialDutyMonthOrder(b.month)),
    [selectedRideSeason],
  );
  const rideScheduleStats = useMemo(() => ({
    away: rideSchedule.filter((match) => match.location === "uit").length,
    kilometers: rideSchedule.reduce((sum, match) => sum + (match.kilometers ?? 0), 0),
  }), [rideSchedule]);
  const materialDutyPersonCount = useMemo(
    () => new Set(materialDuty.flatMap((duty) => duty.persons)).size,
    [materialDuty],
  );
  // Eenmalig bij het mounten: welke maand nu loopt bepaalt welke regel we uitlichten.
  const currentMaterialDutyMonth = useMemo(() => {
    const now = new Date();
    return { season: getSeasonForDate(now), month: now.getMonth() + 1 };
  }, []);
  const boeteTotalsPerUser = useMemo(() => {
    const totals = new Map<string, number>();
    for (const transaction of boeteTransactions) {
      totals.set(transaction.user_id, (totals.get(transaction.user_id) ?? 0) + transaction.amount_change);
    }
    return totals;
  }, [boeteTransactions]);
  const vasteLastenTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.category === "vaste_lasten"),
    [transactions],
  );
  // De vaste lasten pot loopt door, dus dit totaal staat los van het gekozen filter.
  const vasteLastenTotal = useMemo(
    () => vasteLastenTransactions.reduce((sum, transaction) => sum + transaction.amount_change, 0),
    [vasteLastenTransactions],
  );
  const latestFixedCharge = fixedCharges[0] ?? null;
  // Bewust geen standaardkeuze: de admin moet zelf een post kiezen voor hij een betaling verwerkt.
  const paymentFixedChargeId = addMoneyForm.fixedChargeId;
  const activeFixedChargeId = selectedFixedChargeId ?? latestFixedCharge?.id ?? "";
  const activeFixedCharge = useMemo(
    () => fixedCharges.find((charge) => charge.id === activeFixedChargeId) ?? null,
    [activeFixedChargeId, fixedCharges],
  );
  const fixedChargeNameById = useMemo(
    () => new Map(fixedCharges.map((charge) => [charge.id, charge.name])),
    [fixedCharges],
  );
  const fixedChargeTransactionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const transaction of vasteLastenTransactions) {
      if (!transaction.fixed_charge_id) continue;
      counts.set(transaction.fixed_charge_id, (counts.get(transaction.fixed_charge_id) ?? 0) + 1);
    }
    return counts;
  }, [vasteLastenTransactions]);
  // Elke transactie op een post telt als betaald, ongeacht het bedrag.
  const activeFixedChargePerUser = useMemo(() => {
    const totals = new Map<string, number>();
    for (const transaction of vasteLastenTransactions) {
      if (transaction.fixed_charge_id !== activeFixedChargeId) continue;
      totals.set(transaction.user_id, (totals.get(transaction.user_id) ?? 0) + transaction.amount_change);
    }
    return totals;
  }, [activeFixedChargeId, vasteLastenTransactions]);
  const visibleUsers = useMemo(() => {
    if (activeFinanceCategory === "saldo") return sortedUsers;
    if (activeFinanceCategory === "vaste_lasten") {
      return [...users]
        .filter((user) => !isAdmin(user.role))
        .map((user) => ({ ...user, balance: activeFixedChargePerUser.get(user.id) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...users]
      .filter((user) => !isAdmin(user.role))
      .map((user) => ({ ...user, balance: boeteTotalsPerUser.get(user.id) ?? 0 }))
      .sort((a, b) => b.balance - a.balance);
  }, [activeFinanceCategory, activeFixedChargePerUser, boeteTotalsPerUser, sortedUsers, users]);
  // Seizoenen van de saldotransacties: gebruikt door zowel het transactiefilter als de statistieken.
  const statsSeasons = useMemo(() => {
    const seasons = new Set<string>([getCurrentSeason()]);
    for (const transaction of saldoTransactions) seasons.add(getSeasonForDate(transaction.created_at));
    return Array.from(seasons).sort((a, b) => b.localeCompare(a));
  }, [saldoTransactions]);
  // Alleen gebruikers die ook echt een saldotransactie hebben: lege filteropties helpen niemand.
  const saldoTransactionUsers = useMemo(() => {
    const namesById = new Map(users.map((user) => [user.id, user.name]));
    const options = new Map<string, string>();
    for (const transaction of saldoTransactions) {
      if (!transaction.user_id) continue;
      options.set(transaction.user_id, namesById.get(transaction.user_id) ?? transaction.name);
    }
    return Array.from(options, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [saldoTransactions, users]);
  const isSaldoTransactionFilterActive =
    saldoTransactionUserFilter !== allUsersValue || saldoTransactionSeasonFilter !== allTimeSeasonValue || saldoTransactionDirectionFilter !== "alle";
  const filteredSaldoTransactions = useMemo(
    () => saldoTransactions.filter((transaction) => {
      if (saldoTransactionUserFilter !== allUsersValue && transaction.user_id !== saldoTransactionUserFilter) return false;
      if (saldoTransactionSeasonFilter !== allTimeSeasonValue && getSeasonForDate(transaction.created_at) !== saldoTransactionSeasonFilter) return false;
      if (saldoTransactionDirectionFilter === "bij" && transaction.amount_change <= 0) return false;
      if (saldoTransactionDirectionFilter === "af" && transaction.amount_change >= 0) return false;
      return true;
    }),
    [saldoTransactionDirectionFilter, saldoTransactionSeasonFilter, saldoTransactionUserFilter, saldoTransactions],
  );
  // De drie meest recente regels van de aangeklikte speler, binnen de categorie die nu open staat.
  const selectedUserTransactions = useMemo(() => {
    if (!selectedUser) return [];
    const source = activeFinanceCategory === "saldo"
      ? saldoTransactions
      : activeFinanceCategory === "boete"
        ? boeteTransactions
        : vasteLastenTransactions.filter((transaction) => transaction.fixed_charge_id === activeFixedChargeId);
    return source.filter((transaction) => transaction.user_id === selectedUser.id).slice(0, 3);
  }, [activeFinanceCategory, activeFixedChargeId, boeteTransactions, saldoTransactions, selectedUser, vasteLastenTransactions]);
  const filteredSaldoTransactionsTotal = useMemo(
    () => Number(filteredSaldoTransactions.reduce((sum, transaction) => sum + transaction.amount_change, 0).toFixed(2)),
    [filteredSaldoTransactions],
  );
  const filteredTransactions = useMemo(() => {
    if (activeFinanceCategory === "saldo") return filteredSaldoTransactions;
    if (activeFinanceCategory === "vaste_lasten") return vasteLastenTransactions;
    return boeteTransactions;
  }, [activeFinanceCategory, boeteTransactions, filteredSaldoTransactions, vasteLastenTransactions]);
  const activeStatsSeason = selectedStatsSeason ?? statsSeasons[0] ?? allTimeSeasonValue;
  const statsTransactions = useMemo(
    () => activeStatsSeason === allTimeSeasonValue
      ? saldoTransactions
      : saldoTransactions.filter((transaction) => getSeasonForDate(transaction.created_at) === activeStatsSeason),
    [activeStatsSeason, saldoTransactions],
  );
  const totalBalance = useMemo(() => visibleUsers.reduce((sum, user) => sum + user.balance, 0), [visibleUsers]);
  const financeCategoryDescription = activeFinanceCategory === "saldo"
    ? "Teamsaldo totaal"
    : activeFinanceCategory === "boete" ? "Openstaande boetes totaal" : "Totaal saldo";
  const financeCategoryTotal = activeFinanceCategory === "vaste_lasten" ? vasteLastenTotal : totalBalance;
  const financeCategoryTotalParts = splitEuro(financeCategoryTotal);
  // Seizoen (boetes) en post (vaste lasten) horen bij de lijst eronder, dus ze staan onder de sectiekop, net als het saldofilter.
  const categoryFilterBlock = (
    <>
                    {activeFinanceCategory === "boete" ? (
                      <div className="rounded-xl bg-white p-3 shadow-sm">
                        <Label htmlFor="season-filter" className="text-xs uppercase tracking-wide text-slate-500">Seizoen</Label>
                        <select
                          id="season-filter"
                          value={selectedSeason}
                          onChange={(e) => setSelectedSeason(e.target.value)}
                          className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                        >
                          {availableSeasons.map((season) => (
                            <option key={season} value={season}>{season}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {activeFinanceCategory === "vaste_lasten" ? (
                      <div className="rounded-xl bg-white p-3 shadow-sm">
                        <Label htmlFor="fixed-charge-filter" className="text-xs uppercase tracking-wide text-slate-500">Vaste lasten post</Label>
                        {fixedCharges.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-500">Er is nog geen vaste lasten post aangemaakt.</p>
                        ) : (
                          <>
                            <select
                              id="fixed-charge-filter"
                              value={activeFixedChargeId}
                              onChange={(e) => setSelectedFixedChargeId(e.target.value)}
                              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                            >
                              {fixedCharges.map((charge) => (
                                <option key={charge.id} value={charge.id}>{charge.name}</option>
                              ))}
                            </select>
                            {activeFixedCharge ? (
                              <p className="mt-2 text-xs text-slate-400">Aangemaakt op {formatDate(activeFixedCharge.created_at)}</p>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
    </>
  );
  const adminTabLabel = activeFinanceCategory === "saldo"
    ? "Saldo aanpassen"
    : activeFinanceCategory === "boete" ? "Boetes uitdelen" : "Betalingen";
  const adminSectionTitle = activeFinanceCategory === "saldo"
    ? "Saldo aanpassen"
    : activeFinanceCategory === "boete" ? "Boetes uitdelen" : "Betaling verwerken";
  const adminSectionDescription = activeFinanceCategory === "saldo"
    ? "Selecteer 1 of meerdere gebruikers en voeg in één keer hetzelfde bedrag toe."
    : activeFinanceCategory === "boete"
      ? "Selecteer 1 of meerdere gebruikers en geef in één keer hetzelfde boetebedrag."
      : "Kies de vaste lasten post en zet het betaalde bedrag bij de juiste personen.";
  const amountInputLabel = activeFinanceCategory === "boete" ? "Boetebedrag" : "Bedrag";
  const saldoTabOptions: Array<{ value: typeof activeSaldoTab; label: string; icon: typeof Users }> = [
    { value: "overzicht", label: "Spelers", icon: Users },
    { value: "transacties", label: "Transacties", icon: ArrowLeftRight },
    ...(isAdmin(currentUser?.role ?? "user") ? [{ value: "toevoegen" as const, label: adminTabLabel, icon: Plus }] : []),
  ];

  // "Meer tonen" hoort bij één specifieke lijst: zodra categorie of filter wisselt, begint de paginering opnieuw.
  const transactionListKey = `${activeFinanceCategory}|${saldoTransactionUserFilter}|${saldoTransactionSeasonFilter}|${saldoTransactionDirectionFilter}`;
  const transactionLimit = transactionPaging.listKey === transactionListKey ? transactionPaging.limit : transactionPageSize;
  const showMoreTransactions = () => setTransactionPaging({ listKey: transactionListKey, limit: transactionLimit + transactionPageSize });

  const statistics = useMemo(() => {
    const positiveTransactions = statsTransactions.filter((t) => t.amount_change > 0);
    const totalTopUps = positiveTransactions.reduce((sum, t) => sum + t.amount_change, 0);
    const averageTopUp = positiveTransactions.length > 0 ? totalTopUps / positiveTransactions.length : 0;
    const largestTopUp = positiveTransactions.length > 0 ? Math.max(...positiveTransactions.map((t) => t.amount_change)) : 0;

    const topUpsByUser = new Map<string, number>();
    for (const t of positiveTransactions) topUpsByUser.set(t.user_id, (topUpsByUser.get(t.user_id) ?? 0) + t.amount_change);

    const topSpenders = Array.from(topUpsByUser.entries())
      .map(([userId, total]) => ({ userId, total, name: users.find((u) => u.id === userId)?.name ?? "Onbekend" }))
      .sort((a, b) => b.total - a.total).slice(0, 3);

    const monthLabels = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
    const monthlyTotalsMap = new Map<string, { key: string; label: string; total: number; sort: number; perUser: Map<string, number> }>();

    for (const t of positiveTransactions) {
      const d = new Date(t.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${monthLabels[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`;
      const sort = d.getFullYear() * 100 + (d.getMonth() + 1);
      const existing = monthlyTotalsMap.get(key);
      if (existing) {
        existing.total += t.amount_change;
        existing.perUser.set(t.user_id, (existing.perUser.get(t.user_id) ?? 0) + t.amount_change);
      } else {
        const perUser = new Map<string, number>();
        perUser.set(t.user_id, t.amount_change);
        monthlyTotalsMap.set(key, { key, label, total: t.amount_change, sort, perUser });
      }
    }

    const monthlyTotals = Array.from(monthlyTotalsMap.values())
      .sort((a, b) => b.sort - a.sort).slice(0, 6)
      .map((item) => ({
        key: item.key, label: item.label, total: item.total,
        perUserTotals: Array.from(item.perUser.entries())
          .map(([userId, total]) => ({ userId, total, name: users.find((u) => u.id === userId)?.name ?? "Onbekend" }))
          .sort((a, b) => b.total - a.total),
      }));

    const dailyExpensesMap = new Map<string, { key: string; label: string; total: number; perUser: Map<string, number> }>();

    for (const t of statsTransactions) {
      if (t.amount_change >= 0) continue;
      const d = new Date(t.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const existing = dailyExpensesMap.get(key);
      if (existing) {
        existing.total += t.amount_change;
        existing.perUser.set(t.user_id, (existing.perUser.get(t.user_id) ?? 0) + t.amount_change);
      } else {
        const perUser = new Map<string, number>();
        perUser.set(t.user_id, t.amount_change);
        dailyExpensesMap.set(key, { key, label: formatDate(t.created_at), total: t.amount_change, perUser });
      }
    }

    const dailyExpenses = Array.from(dailyExpensesMap.values())
      .sort((a, b) => b.key.localeCompare(a.key))
      .map((item) => ({
        key: item.key, label: item.label, total: item.total,
        perUserTotals: Array.from(item.perUser.entries())
          .map(([userId, total]) => ({ userId, total, name: users.find((u) => u.id === userId)?.name ?? "Onbekend" }))
          .sort((a, b) => a.total - b.total),
      }));

    return { positiveCount: positiveTransactions.length, totalTopUps, averageTopUp, largestTopUp, topSpenders, monthlyTotals, dailyExpenses };
  }, [statsTransactions, users]);

  // Volgt het seizoensfilter van de statistieken: gebruikt door de Kas-kanonnen.
  const totalPositivePerUser = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of statsTransactions) {
      if (t.amount_change <= 0) continue;
      totals.set(t.user_id, (totals.get(t.user_id) ?? 0) + t.amount_change);
    }
    return totals;
  }, [statsTransactions]);
  // Aller tijden, los van dat filter: de spelerspopup toont wat iemand in totaal heeft gestort.
  const allTimePositivePerUser = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of saldoTransactions) {
      if (t.amount_change <= 0) continue;
      totals.set(t.user_id, (totals.get(t.user_id) ?? 0) + t.amount_change);
    }
    return totals;
  }, [saldoTransactions]);

  const spenderChartData = useMemo(
    () => [...users]
      .filter((user) => !isAdmin(user.role))
      .map((user) => ({
        userId: user.id,
        username: user.username,
        total: totalPositivePerUser.get(user.id) ?? 0,
      }))
      .filter((user) => user.total > 0)
      .sort((a, b) => b.total - a.total),
    [totalPositivePerUser, users],
  );

  const statisticsKpis: Array<{ key: StatsKpiKey; label: string; value: string }> = [
    { key: "count", label: "Opwaarderingen", value: String(statistics.positiveCount) },
    { key: "total", label: "Totaal opgewaardeerd", value: euro(statistics.totalTopUps) },
    { key: "average", label: "Gemiddelde opwaardering", value: euro(statistics.averageTopUp) },
    { key: "largest", label: "Grootste opwaardering", value: euro(statistics.largestTopUp) },
  ];

  // Achter elke KPI-tegel zit een popup: drie ranglijsten en een histogram van de opwaarderingen.
  const statisticsDetails = useMemo(() => {
    const positiveTransactions = statsTransactions.filter((t) => t.amount_change > 0);
    const perUser = new Map<string, { count: number; total: number; largest: number }>();
    for (const t of positiveTransactions) {
      const entry = perUser.get(t.user_id) ?? { count: 0, total: 0, largest: 0 };
      entry.count += 1;
      entry.total += t.amount_change;
      entry.largest = Math.max(entry.largest, t.amount_change);
      perUser.set(t.user_id, entry);
    }
    const rows = Array.from(perUser, ([userId, entry]) => {
      const user = users.find((u) => u.id === userId) ?? null;
      return { userId, user, name: user?.name ?? "Onbekend", ...entry };
    });
    const topBy = (key: "count" | "total" | "largest") => [...rows].sort((a, b) => b[key] - a[key]).slice(0, 5);

    const largest = Math.max(...positiveTransactions.map((t) => t.amount_change), 0);
    const bucketSize = 10;
    const bucketCount = positiveTransactions.length === 0 ? 0 : Math.max(1, Math.ceil(largest / bucketSize));
    const histogram = Array.from({ length: bucketCount }, (_, index) => ({ from: index * bucketSize, to: (index + 1) * bucketSize, count: 0 }));
    const bucketIndexFor = (amount: number) => Math.min(Math.floor(amount / bucketSize), bucketCount - 1);
    for (const t of positiveTransactions) histogram[bucketIndexFor(t.amount_change)].count += 1;
    const averageTopUp = positiveTransactions.length > 0 ? positiveTransactions.reduce((sum, t) => sum + t.amount_change, 0) / positiveTransactions.length : 0;

    return {
      topByCount: topBy("count"),
      topByTotal: topBy("total"),
      topByLargest: topBy("largest"),
      histogram,
      histogramMax: Math.max(...histogram.map((bucket) => bucket.count), 1),
      bucketSize,
      averageBucketIndex: bucketCount === 0 ? -1 : bucketIndexFor(averageTopUp),
    };
  }, [statsTransactions, users]);
  const statsKpiRanking = activeStatsKpi === "count"
    ? statisticsDetails.topByCount
    : activeStatsKpi === "total"
      ? statisticsDetails.topByTotal
      : activeStatsKpi === "largest"
        ? statisticsDetails.topByLargest
        : [];
  const spenderChartMax = Math.max(...spenderChartData.map((item) => item.total), 1);

  const joostUserIds = useMemo(
    () => new Set(users.filter((user) => user.name === "Joost Jansen").map((user) => user.id)),
    [users],
  );

  const filteredAppEvents = useMemo(() => {
    if (!excludeJoostEvents) return appEvents;
    return appEvents.filter((event) => !event.user_id || !joostUserIds.has(event.user_id));
  }, [appEvents, excludeJoostEvents, joostUserIds]);

  const aggregatedAppEvents = useMemo(() => {
    if (!isDev(currentUser?.role ?? "user")) return [];

    const buckets = new Map<string, { key: string; label: string; count: number; sortValue: number }>();
    for (const event of filteredAppEvents) {
      const bucketStart = getBucketStart(event.created_at, eventAggregation);
      const key = bucketStart.toISOString();
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        buckets.set(key, {
          key,
          label: formatEventBucketLabel(bucketStart, eventAggregation),
          count: 1,
          sortValue: bucketStart.getTime(),
        });
      }
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.sortValue - b.sortValue)
      .map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.count }));
  }, [currentUser?.role, eventAggregation, filteredAppEvents]);

  const appEventTableRows = useMemo(() => {
    const usersById = new Map(users.map((user) => [user.id, user.name]));
    return [...filteredAppEvents]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((event) => ({
        id: event.id,
        createdAt: formatDateTime(event.created_at),
        name: event.user_id ? usersById.get(event.user_id) ?? "Onbekend" : "Onbekend",
      }));
  }, [filteredAppEvents, users]);

  const isDevUser = isDev(currentUser?.role ?? "user");
  const devUsageSection = isDevUser ? (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 }}>
      <Card className="rounded-xl border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-xl">Gebruikersstatistieken</CardTitle>
              <p className="mt-1 text-sm text-slate-500">`login` en `session_resume` events over tijd.</p>
            </div>
            <div className="w-full space-y-3 sm:w-56">
              <div>
                <Label htmlFor="event-aggregation">Aggregatie</Label>
                <select
                  id="event-aggregation"
                  value={eventAggregation}
                  onChange={(e) => setEventAggregation(e.target.value as EventAggregation)}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-red-300 focus:ring-2 focus:ring-red-100"
                >
                  {eventAggregationOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={excludeJoostEvents}
                  onChange={(e) => setExcludeJoostEvents(e.target.checked)}
                  className="h-4 w-4 accent-slate-900"
                />
                <span>Developer uitsluiten</span>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {aggregatedAppEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Nog geen `login` of `session_resume` events beschikbaar voor de grafiek.
            </div>
          ) : (
            <UsageLineChart points={aggregatedAppEvents} />
          )}

          <div className="space-y-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">Gebeurtenissen</h4>
              <p className="mt-1 text-sm text-slate-500">Chronologisch overzicht van de events die in deze grafiek meetellen.</p>
            </div>

            <div className="overflow-hidden rounded-xl border bg-white">
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-white">
                    <TableRow>
                      <TableHead>Datum en tijd</TableHead>
                      <TableHead>Naam</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {appEventTableRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2} className="text-center text-slate-500">Nog geen gebeurtenissen beschikbaar.</TableCell>
                      </TableRow>
                    ) : (
                      appEventTableRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.createdAt}</TableCell>
                          <TableCell>{row.name}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  ) : null;

  const login = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    try {
      const normalizedUsername = username.trim();
      if (!normalizedUsername || !password.trim()) { setError("Vul gebruikersnaam en wachtwoord in."); return; }
      const safeUsername = sanitizeUsername(normalizedUsername);
      if (!safeUsername) { setError("Vul een geldige gebruikersnaam in."); return; }
      const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: usernameToAuthEmail(safeUsername), password });
      if (loginError) { setError("Onjuiste gebruikersnaam of wachtwoord."); return; }
      if (data.user?.id) await logAppEvent(data.user.id, "login");
      setUsername("");
      setPassword("");
    } catch (loginFlowError) {
      console.error("Fout tijdens inloggen:", loginFlowError);
      setError("Inloggen mislukt door een onverwachte fout. Probeer opnieuw.");
    }
  };

  const logout = async () => {
    if (currentUser?.id) await logAppEvent(currentUser.id, "logout");
    const { error: logoutError } = await supabase.auth.signOut({ scope: "local" });
    if (logoutError) console.error("Fout bij uitloggen:", logoutError);
    resetAuthState();
    setIsProfilePageOpen(false);
    setIsPasswordModalOpen(false);
  };

  const updateCurrentUserAvatar = async (avatar: string) => {
    if (!currentUser) return;
    const previousAvatar = currentUser.avatar;
    const { error } = await supabase.from("users").update({ avatar }).eq("id", currentUser.id);
    if (error) { console.error("Fout bij opslaan avatar:", error); return; }
    setUsers((prev) => prev.map((u) => u.id === currentUser.id ? { ...u, avatar } : u));
    setCurrentUser((prev) => prev ? { ...prev, avatar } : prev);
    setSelectedUser((prev) => prev?.id === currentUser.id ? { ...prev, avatar } : prev);
    updateAvatarCacheForUser(currentUser.id, avatar);
    if (previousAvatar && previousAvatar !== avatar) await removeAvatarObject(previousAvatar);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentUser) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = reader.result;
      if (typeof result === "string") {
        const resizedAvatar = await resizeAvatar(result);
        const avatarBlob = await dataUrlToBlob(resizedAvatar);
        const avatarPath = buildAvatarObjectPath(currentUser.id);
        const { error: uploadError } = await supabase.storage.from(avatarBucket).upload(avatarPath, avatarBlob, { contentType: "image/webp", upsert: false });
        if (uploadError) { console.error("Fout bij uploaden avatar:", uploadError); return; }
        try { await updateCurrentUserAvatar(avatarPath); } catch (updateError) { await removeAvatarObject(avatarPath); throw updateError; }
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeAvatar = async () => {
    if (!currentUser) return;
    const previousAvatar = currentUser.avatar;
    const { error } = await supabase.from("users").update({ avatar: "" }).eq("id", currentUser.id);
    if (error) { console.error("Fout bij verwijderen avatar:", error); return; }
    setUsers((prev) => prev.map((u) => u.id === currentUser.id ? { ...u, avatar: "" } : u));
    setCurrentUser((prev) => prev ? { ...prev, avatar: "" } : prev);
    setSelectedUser((prev) => prev?.id === currentUser.id ? { ...prev, avatar: "" } : prev);
    updateAvatarCacheForUser(currentUser.id, "");
    await removeAvatarObject(previousAvatar);
  };

  const changePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordMessage("");
    if (!currentPasswordForChange) { setPasswordMessage("Vul je huidige wachtwoord in."); return; }
    if (newPassword.length < 8) { setPasswordMessage("Wachtwoord moet minimaal 8 tekens zijn."); return; }
    if (newPassword !== confirmPassword) { setPasswordMessage("Wachtwoorden komen niet overeen."); return; }
    setIsSavingPassword(true);
    const { data: { user: authUser }, error: authUserError } = await supabase.auth.getUser();
    if (authUserError || !authUser?.email) { setIsSavingPassword(false); setPasswordMessage("Kon je account niet verifiëren. Log opnieuw in."); return; }
    const { error: reAuthError } = await supabase.auth.signInWithPassword({ email: authUser.email, password: currentPasswordForChange });
    if (reAuthError) { setIsSavingPassword(false); setPasswordMessage("Huidig wachtwoord is onjuist."); return; }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setIsSavingPassword(false);
    if (updateError) { setPasswordMessage("Wachtwoord wijzigen mislukt. Probeer opnieuw."); console.error("Fout bij wachtwoord wijzigen:", updateError); return; }
    setCurrentPasswordForChange(""); setNewPassword(""); setConfirmPassword("");
    setPasswordMessage("Wachtwoord succesvol gewijzigd.");
  };

  const createUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAddUserMessage("");
    if (!addUserForm.username.trim()) { setAddUserMessage("Vul een gebruikersnaam in."); return; }
    if (!addUserForm.name.trim()) { setAddUserMessage("Vul de volledige naam in."); return; }
    if (addUserForm.password.length < 8) { setAddUserMessage("Wachtwoord moet minimaal 8 tekens zijn."); return; }

    setIsSavingUser(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setAddUserMessage("Sessie verlopen. Log opnieuw in."); return; }

      const response = await fetch("/api/dev/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(addUserForm),
      });
      const result = await response.json();
      if (!response.ok) { setAddUserMessage(result.error ?? "Gebruiker toevoegen mislukt."); return; }

      await refreshUsers({ force: true });
      setAddUserForm({ username: "", name: "", password: "" });
      setAddUserMessage(`${result.user.name} is toegevoegd. Inloggen kan met gebruikersnaam "${result.user.username}".`);
    } catch (createError) {
      console.error("Fout bij toevoegen gebruiker:", createError);
      setAddUserMessage("Gebruiker toevoegen mislukt. Probeer opnieuw.");
    } finally {
      setIsSavingUser(false);
    }
  };

  const toggleSelectedUser = (id: string) => {
    setAddMoneyForm((prev) => ({
      ...prev,
      selectedUserIds: prev.selectedUserIds.includes(id) ? prev.selectedUserIds.filter((uid) => uid !== id) : [...prev.selectedUserIds, id],
      message: "",
    }));
  };

  const createFixedCharge = async () => {
    const name = fixedChargeForm.name.trim();
    if (!name) { setFixedChargeForm((prev) => ({ ...prev, message: "Vul een naam in." })); return; }

    setIsSavingFixedCharge(true);
    try {
      const { data, error: insertError } = await supabase
        .from("fixed_charges")
        .insert({ name })
        .select("id, created_at, name")
        .single();
      if (insertError || !data) {
        console.error("Fout bij aanmaken vaste lasten:", insertError);
        setFixedChargeForm((prev) => ({ ...prev, message: "Aanmaken van de vaste lasten is mislukt." }));
        return;
      }

      await refreshUsers({ force: true });
      setSelectedFixedChargeId(data.id);
      setAddMoneyForm((prev) => ({ ...prev, fixedChargeId: data.id, message: "" }));
      setFixedChargeForm({ name: "", message: `"${data.name}" is aangemaakt.` });
    } finally {
      setIsSavingFixedCharge(false);
    }
  };

  // Een post mag alleen weg zolang er geen transacties op staan; de database blokkeert het anders ook.
  const deleteFixedCharge = async (charge: FixedCharge) => {
    const transactionCount = fixedChargeTransactionCounts.get(charge.id) ?? 0;
    if (transactionCount > 0) {
      setFixedChargeForm((prev) => ({ ...prev, message: `"${charge.name}" heeft ${transactionCount} transactie(s) en kan niet verwijderd worden.` }));
      return;
    }
    if (!window.confirm(`"${charge.name}" verwijderen?`)) return;

    setDeletingFixedChargeId(charge.id);
    try {
      const { data, error: deleteError } = await supabase
        .from("fixed_charges").delete().eq("id", charge.id).select("id");
      if (deleteError || !data || data.length === 0) {
        console.error("Fout bij verwijderen vaste lasten:", deleteError);
        setFixedChargeForm((prev) => ({ ...prev, message: `"${charge.name}" verwijderen is mislukt.` }));
        return;
      }

      if (selectedFixedChargeId === charge.id) setSelectedFixedChargeId(null);
      setAddMoneyForm((prev) => (prev.fixedChargeId === charge.id ? { ...prev, fixedChargeId: "" } : prev));
      await refreshUsers({ force: true });
      setFixedChargeForm((prev) => ({ ...prev, message: `"${charge.name}" is verwijderd.` }));
    } finally {
      setDeletingFixedChargeId(null);
    }
  };

  // Geld dat uit de pot is uitgegeven: niet op naam van een speler en niet gekoppeld aan een post.
  const addPotPayment = async () => {
    const parsedAmount = Number(potPaymentForm.amount.replace(",", "."));
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
      setPotPaymentForm((prev) => ({ ...prev, message: "Vul een geldig bedrag in." }));
      return;
    }

    const amountChange = -Math.abs(parsedAmount);
    setIsSavingPotPayment(true);
    try {
      const { error: transactionError } = await supabase.from("transactions").insert({
        user_id: null,
        name: "Vaste lasten",
        amount_change: amountChange,
        category: "vaste_lasten",
        season: getCurrentSeason(),
        fixed_charge_id: null,
      });
      if (transactionError) {
        console.error("Fout bij verwerken uitgave vaste lasten:", transactionError);
        setPotPaymentForm((prev) => ({ ...prev, message: "Uitgave verwerken is mislukt." }));
        return;
      }

      await refreshUsers({ force: true });
      setPotPaymentForm({ amount: "", message: `${euro(Math.abs(amountChange))} uit de vaste lasten pot geboekt.` });
    } finally {
      setIsSavingPotPayment(false);
    }
  };

  const addMoneyToSelectedUsers = async () => {
    const parsedAmount = Number(addMoneyForm.amount.replace(",", "."));
    if (addMoneyForm.selectedUserIds.length === 0) { setAddMoneyForm((prev) => ({ ...prev, message: "Selecteer minstens 1 gebruiker." })); return; }
    if (!Number.isFinite(parsedAmount)) { setAddMoneyForm((prev) => ({ ...prev, message: "Vul een geldig bedrag in." })); return; }
    if (activeFinanceCategory === "vaste_lasten" && parsedAmount <= 0) {
      setAddMoneyForm((prev) => ({ ...prev, message: "Vul een positief bedrag in. Geld uit de pot boek je bij Betalingen uit vaste lasten." }));
      return;
    }
    if (activeFinanceCategory === "vaste_lasten" && !paymentFixedChargeId) {
      setAddMoneyForm((prev) => ({ ...prev, message: fixedCharges.length === 0 ? "Maak eerst een vaste lasten post aan." : "Kies eerst een vaste lasten post." }));
      return;
    }

    for (const userId of addMoneyForm.selectedUserIds) {
      const user = users.find((u) => u.id === userId);
      if (!user) continue;
      if (activeFinanceCategory === "saldo") {
        const newBalance = Number((user.balance + parsedAmount).toFixed(2));
        const { error: updateError } = await supabase.from("users").update({ balance: newBalance }).eq("id", userId);
        if (updateError) { setAddMoneyForm((prev) => ({ ...prev, message: "Saldo opslaan mislukt." })); return; }
      }
      const { error: transactionError } = await supabase
        .from("transactions")
        .insert({
          user_id: user.id,
          name: user.name,
          amount_change: parsedAmount,
          category: activeFinanceCategory,
          season: activeFinanceCategory === "boete" ? selectedSeason : getCurrentSeason(),
          fixed_charge_id: activeFinanceCategory === "vaste_lasten" ? paymentFixedChargeId : null,
        });
      if (transactionError) { setAddMoneyForm((prev) => ({ ...prev, message: "Transactie opslaan mislukt." })); return; }
    }

    await refreshUsers();
    setAddMoneyForm({
      selectedUserIds: [],
      amount: "",
      fixedChargeId: addMoneyForm.fixedChargeId,
      message: activeFinanceCategory === "saldo"
        ? `€ ${parsedAmount.toFixed(2)} toegevoegd aan ${addMoneyForm.selectedUserIds.length} gebruiker(s).`
        : activeFinanceCategory === "boete"
          ? `€ ${parsedAmount.toFixed(2)} boete gegeven aan ${addMoneyForm.selectedUserIds.length} gebruiker(s).`
          : `€ ${parsedAmount.toFixed(2)} verwerkt voor ${addMoneyForm.selectedUserIds.length} gebruiker(s) op "${fixedChargeNameById.get(paymentFixedChargeId) ?? "vaste lasten"}".`,
    });
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center">
        <div className="text-sm text-slate-500">Laden...</div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4 md:p-8">
        <div className="mx-auto flex min-h-[85vh] max-w-md items-center justify-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="w-full">
            <Card className="rounded-xl border-0 shadow-xl">
              <CardHeader className="space-y-3 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-slate-900 text-white shadow-lg">
                  <Wallet className="h-7 w-7" />
                </div>
                <div>
                  <CardTitle className="text-2xl font-bold">Saldo Tracker</CardTitle>
                  <p className="mt-2 text-sm text-slate-500">Log in om de teamsaldo&apos;s te bekijken.</p>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={login} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Gebruikersnaam</Label>
                    <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Je gebruikersnaam" className="h-12 rounded-xl" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Wachtwoord</Label>
                    <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Je wachtwoord" className="h-12 rounded-xl" />
                  </div>
                  {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div> : null}
                  <Button type="submit" className="h-12 w-full rounded-xl text-base">Inloggen</Button>
                </form>
                <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  <p className="font-medium text-slate-800">Versie 1.1.0</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-4 sm:pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-6 md:pb-[calc(6rem+env(safe-area-inset-bottom))]">

      {isPullRefreshing ? (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center py-3 bg-white/80 backdrop-blur text-sm text-slate-500">
          Verversen...
        </div>
      ) : null}

      <div className="mx-auto max-w-2xl space-y-4">
        {isProfilePageOpen ? (
          <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} className="space-y-4">
            <div className="relative flex h-10 items-center justify-center">
              <button
                type="button"
                onClick={() => setIsProfilePageOpen(false)}
                className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-900 shadow-sm transition hover:bg-slate-50"
                aria-label="Terug"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <h1 className="text-lg font-semibold text-slate-900">Profiel bewerken</h1>
            </div>

            <div className="rounded-xl bg-white px-5 py-6 text-center shadow-sm">
              <div className="relative mx-auto h-24 w-24">
                <UserAvatar name={currentUser.name} avatar={getAvatarForUser(currentUser)} className="h-24 w-24 ring-4 ring-[#f3f4f6]" fallbackClassName="text-2xl" />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white ring-4 ring-white transition hover:bg-slate-700"
                  aria-label="Profielfoto wijzigen"
                >
                  <Camera className="h-4 w-4" />
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
              <p className="mt-4 text-lg font-semibold text-slate-900">{currentUser.name}</p>
              <p className="text-sm text-slate-500">@{currentUser.username}</p>
              {currentUser.avatar ? (
                <button type="button" onClick={removeAvatar} className="mt-3 text-sm font-medium text-red-600 transition hover:text-red-700">
                  Profielfoto verwijderen
                </button>
              ) : (
                <p className="mt-3 text-sm text-slate-400">Tik op de camera om een foto te kiezen.</p>
              )}
            </div>

            <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
              <div className="rounded-xl border border-slate-200 px-4 py-2.5">
                <p className="text-xs text-slate-400">Volledige naam</p>
                <p className="text-sm font-medium text-slate-900">{currentUser.name}</p>
              </div>
              <div className="rounded-xl border border-slate-200 px-4 py-2.5">
                <p className="text-xs text-slate-400">Gebruikersnaam</p>
                <p className="text-sm font-medium text-slate-900">@{currentUser.username}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 px-4 py-2.5">
                  <p className="text-xs text-slate-400">Rol</p>
                  <p className="text-sm font-medium text-slate-900">{getRoleLabel(currentUser.role)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 px-4 py-2.5">
                  <p className="text-xs text-slate-400">Laatst bijgewerkt</p>
                  <p className="text-sm font-medium text-slate-900">{lastDataRefreshAt ? formatDateTime(lastDataRefreshAt) : "-"}</p>
                </div>
              </div>
              <p className="px-1 text-xs text-slate-400">Je naam en gebruikersnaam kan alleen een admin aanpassen.</p>
            </div>

            <div className="divide-y divide-slate-100 rounded-xl bg-white p-2 shadow-sm">
              <button
                type="button"
                onClick={() => { setPasswordMessage(""); setCurrentPasswordForChange(""); setNewPassword(""); setConfirmPassword(""); setIsPasswordModalOpen(true); }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-slate-50"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f3f4f6] text-slate-700"><KeyRound className="h-4 w-4" /></span>
                <span className="flex-1 text-sm font-medium text-slate-900">Wachtwoord wijzigen</span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
              {isDev(currentUser.role) ? (
                <button
                  type="button"
                  onClick={() => { setAddUserMessage(""); setAddUserForm({ username: "", name: "", password: "" }); setIsAddUserModalOpen(true); }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-slate-50"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f3f4f6] text-slate-700"><UserPlus className="h-4 w-4" /></span>
                  <span className="flex-1 text-sm font-medium text-slate-900">Gebruiker toevoegen</span>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={logout}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" />
              Uitloggen
            </button>
          </motion.div>
        ) : (
          <>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <button
                type="button"
                onClick={() => setIsProfilePageOpen(true)}
                className="flex w-full items-center gap-3 rounded-xl bg-white p-4 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
              >
                <UserAvatar name={currentUser.name} avatar={getAvatarForUser(currentUser)} className="h-14 w-14 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-slate-900">{currentUser.name}</p>
                  <p className="truncate text-sm text-slate-500">@{currentUser.username} · {getRoleLabel(currentUser.role)}</p>
                  {lastDataRefreshAt ? (
                    <p className="mt-0.5 text-xs text-slate-400">Bijgewerkt {formatDateTime(lastDataRefreshAt)}</p>
                  ) : null}
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
              </button>
            </motion.div>

            {activeMainTab === "saldo" ? (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 }} className="space-y-4">
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-white p-1 shadow-sm">
                  {financeCategoryOptions.map((option) => {
                    const isActive = activeFinanceCategory === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setActiveFinanceCategory(option.value)}
                        className={`h-10 rounded-lg text-sm font-medium transition ${isActive ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <div className="relative rounded-xl bg-white px-5 py-8 text-center shadow-sm">
                  {isAdmin(currentUser.role) ? (
                    <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-[#f3f4f6] px-2.5 py-1 text-xs font-medium text-slate-600">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Admin
                    </span>
                  ) : null}
                  <p className="text-sm text-slate-500">{financeCategoryDescription}</p>
                  <p className="mt-1 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
                    {financeCategoryTotalParts.main}
                    <span className="text-slate-400">{financeCategoryTotalParts.cents}</span>
                  </p>
                  {activeFinanceCategory === "saldo" ? (
                    <p className="mt-3 text-sm text-slate-500">{sortedUsers.length} spelers · {saldoTransactions.length} transacties</p>
                  ) : null}
                  {activeFinanceCategory === "boete" ? (
                    <p className="mt-3 text-sm text-slate-500">{visibleUsers.filter((user) => user.balance > 0).length} spelers met boete · {boeteTransactions.length} boetes</p>
                  ) : null}
                  {activeFinanceCategory === "vaste_lasten" ? (
                    <p className="mt-3 text-sm text-slate-500">
                      {fixedCharges.length === 0
                        ? "Nog geen vaste lasten post aangemaakt"
                        : `${activeFixedChargePerUser.size} van ${sortedUsers.length} betaald · ${vasteLastenTransactions.length} transacties`}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-xl bg-white p-4 shadow-sm">
                  <div className={`grid ${isAdmin(currentUser.role) ? "grid-cols-3" : "grid-cols-2"}`}>
                    {saldoTabOptions.map((option) => {
                      const isActive = activeSaldoTab === option.value;
                      const Icon = option.icon;
                      return (
                        <button key={option.value} type="button" onClick={() => setActiveSaldoTab(option.value)} className="flex flex-col items-center gap-2">
                          <span className={`flex h-12 w-12 items-center justify-center rounded-full transition ${isActive ? "bg-slate-900 text-white" : "bg-[#f3f4f6] text-slate-700"}`}>
                            <Icon className="h-5 w-5" />
                          </span>
                          <span className={`text-xs font-medium ${isActive ? "text-slate-900" : "text-slate-500"}`}>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {activeSaldoTab === "overzicht" ? (
                  <section className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <h2 className="text-sm font-semibold text-slate-900">Spelers</h2>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">{visibleUsers.length}</span>
                    </div>
                    {categoryFilterBlock}
                    {activeFinanceCategory === "vaste_lasten" && fixedCharges.length === 0 ? (
                      <div className="rounded-xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm">Maak eerst een vaste lasten post aan.</div>
                    ) : (
                      visibleUsers.map((user) => {
                        const hasPaid = activeFixedChargePerUser.has(user.id);
                        return (
                          <div key={user.id} className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
                            <button type="button" onClick={() => setSelectedUser(user)} className="shrink-0 rounded-full">
                              <UserAvatar name={user.name} avatar={getAvatarForUser(user)} className="h-11 w-11 cursor-pointer transition hover:scale-105" />
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-slate-900">{user.name}</p>
                              <p className="truncate text-sm text-slate-500">
                                {activeFinanceCategory === "vaste_lasten"
                                  ? hasPaid ? `Betaald · ${euro(user.balance)}` : "Nog niet betaald"
                                  : `@${user.username}`}
                              </p>
                            </div>
                            {activeFinanceCategory === "vaste_lasten" ? (
                              hasPaid ? (
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500" aria-label="Betaald">
                                  <Check className="h-4 w-4 text-white" />
                                </span>
                              ) : (
                                <span className="block h-7 w-7 shrink-0 rounded-full border-2 border-slate-300" aria-label="Nog niet betaald" />
                              )
                            ) : (
                              <p className={`shrink-0 font-semibold ${activeFinanceCategory === "boete" && user.balance > 0 ? "text-red-600" : "text-slate-900"}`}>
                                {euro(user.balance)}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </section>
                ) : activeSaldoTab === "transacties" ? (
                  <section className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <h2 className="text-sm font-semibold text-slate-900">Transacties</h2>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">{filteredTransactions.length}</span>
                    </div>
                    {categoryFilterBlock}
                    {activeFinanceCategory === "saldo" ? (
                      <div className="space-y-3 rounded-xl bg-white p-3 shadow-sm">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label htmlFor="saldo-transaction-user-filter" className="text-xs uppercase tracking-wide text-slate-500">Gebruiker</Label>
                            <select
                              id="saldo-transaction-user-filter"
                              value={saldoTransactionUserFilter}
                              onChange={(e) => setSaldoTransactionUserFilter(e.target.value)}
                              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                            >
                              <option value={allUsersValue}>Alle gebruikers</option>
                              {saldoTransactionUsers.map((user) => (
                                <option key={user.id} value={user.id}>{user.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label htmlFor="saldo-transaction-season-filter" className="text-xs uppercase tracking-wide text-slate-500">Seizoen</Label>
                            <select
                              id="saldo-transaction-season-filter"
                              value={saldoTransactionSeasonFilter}
                              onChange={(e) => setSaldoTransactionSeasonFilter(e.target.value)}
                              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                            >
                              <option value={allTimeSeasonValue}>Alle seizoenen</option>
                              {statsSeasons.map((season) => (
                                <option key={season} value={season}>{season}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs uppercase tracking-wide text-slate-500">Richting</Label>
                          <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-[#f3f4f6] p-1">
                            {transactionDirectionOptions.map((option) => {
                              const isActive = saldoTransactionDirectionFilter === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => setSaldoTransactionDirectionFilter(option.value)}
                                  className={`h-9 rounded-lg text-sm font-medium transition ${isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm text-slate-500">
                            {filteredSaldoTransactions.length} van {saldoTransactions.length} transacties
                            <span className="text-slate-400"> &middot; </span>
                            totaal <span className="font-medium text-slate-900">{euro(filteredSaldoTransactionsTotal)}</span>
                          </p>
                          {isSaldoTransactionFilterActive ? (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => { setSaldoTransactionUserFilter(allUsersValue); setSaldoTransactionSeasonFilter(allTimeSeasonValue); setSaldoTransactionDirectionFilter("alle"); }}
                              className="h-9 rounded-full px-3 text-sm"
                            >
                              Filters wissen
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {filteredTransactions.length === 0 ? (
                      <div className="rounded-xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm">
                        {activeFinanceCategory === "saldo" && isSaldoTransactionFilterActive ? "Geen transacties voor dit filter." : "Nog geen transacties."}
                      </div>
                    ) : (
                      filteredTransactions.slice(0, transactionLimit).map((transaction) => {
                        const isIncoming = transaction.amount_change >= 0;
                        const isBoete = transaction.category === "boete";
                        return (
                          <div key={transaction.id} className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
                            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${isBoete ? "bg-red-50 text-red-600" : "bg-[#f3f4f6] text-slate-700"}`}>
                              {isBoete ? <Receipt className="h-5 w-5" /> : isIncoming ? <ArrowDownLeft className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-slate-900">{transaction.name}</p>
                              <p className="truncate text-sm text-slate-500">{getTransactionKindLabel(transaction)} · {formatDate(transaction.created_at)}</p>
                            </div>
                            <p className={`shrink-0 font-semibold ${isBoete ? "text-red-600" : "text-slate-900"}`}>
                              {!isBoete && transaction.amount_change > 0 ? "+" : ""}{euro(transaction.amount_change)}
                            </p>
                          </div>
                        );
                      })
                    )}
                    {filteredTransactions.length > transactionLimit ? (
                      <button
                        type="button"
                        onClick={showMoreTransactions}
                        className="w-full rounded-xl bg-white py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                      >
                        Meer tonen ({filteredTransactions.length - transactionLimit} resterend)
                      </button>
                    ) : null}
                  </section>
                ) : isAdmin(currentUser.role) ? (
                  <section className="space-y-4">
                    {categoryFilterBlock}
                    {activeFinanceCategory === "vaste_lasten" ? (
                      <Button
                        type="button"
                        onClick={() => { setFixedChargeForm((prev) => ({ ...prev, message: "" })); setIsFixedChargeModalOpen(true); }}
                        className="h-12 w-full rounded-xl"
                      >
                        Post aanmaken of verwijderen
                      </Button>
                    ) : null}

                    <div className="rounded-xl bg-white p-4 shadow-sm">
                      <div className="space-y-1">
                        <h3 className="text-base font-semibold text-slate-900">{adminSectionTitle}</h3>
                        <p className="text-sm text-slate-500">{adminSectionDescription}</p>
                      </div>
                      <div className="mt-4 space-y-4">
                        {activeFinanceCategory === "vaste_lasten" ? (
                          <div className="space-y-2">
                            <Label htmlFor="payment-fixed-charge">Vaste lasten post</Label>
                            {fixedCharges.length === 0 ? (
                              <p className="text-sm text-slate-500">Maak hierboven eerst een vaste lasten post aan.</p>
                            ) : (
                              <select
                                id="payment-fixed-charge"
                                value={paymentFixedChargeId}
                                onChange={(e) => setAddMoneyForm((prev) => ({ ...prev, fixedChargeId: e.target.value, message: "" }))}
                                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                              >
                                <option value="">Kies een post</option>
                                {fixedCharges.map((charge) => (
                                  <option key={charge.id} value={charge.id}>{charge.name}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        ) : null}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>Gebruikers selecteren</Label>
                            <span className="text-xs text-slate-500">{addMoneyForm.selectedUserIds.length} geselecteerd</span>
                          </div>
                          <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl bg-[#f3f4f6] p-2">
                            {visibleUsers.map((user) => {
                              const selected = addMoneyForm.selectedUserIds.includes(user.id);
                              return (
                                <button
                                  key={user.id} type="button" onClick={() => toggleSelectedUser(user.id)}
                                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${selected ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"}`}
                                >
                                  <UserAvatar name={user.name} avatar={getAvatarForUser(user)} className="h-10 w-10 shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium">{user.name}</p>
                                    <p className={`truncate text-sm ${selected ? "text-slate-300" : "text-slate-500"}`}>
                                      {activeFinanceCategory === "saldo" ? "Huidig saldo" : activeFinanceCategory === "boete" ? "Openstaande boetes" : "Betaald voor deze post"}: {euro(user.balance)}
                                    </p>
                                  </div>
                                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${selected ? "bg-white text-slate-900" : "border-2 border-slate-300"}`}>
                                    {selected ? <Check className="h-3.5 w-3.5" /> : null}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="amount">{amountInputLabel}</Label>
                          <Input
                            id="amount" type="number" step="0.01" min={activeFinanceCategory === "vaste_lasten" ? "0" : undefined} value={addMoneyForm.amount}
                            onChange={(e) => setAddMoneyForm((prev) => ({ ...prev, amount: e.target.value, message: "" }))}
                            placeholder={activeFinanceCategory === "boete" ? "Bijv. 5,00" : "Bijv. 10,50"} className="h-12 rounded-xl"
                          />
                        </div>
                        <Button
                          onClick={addMoneyToSelectedUsers}
                          disabled={activeFinanceCategory === "vaste_lasten" && !paymentFixedChargeId}
                          className="h-12 w-full rounded-xl"
                        >
                          <PlusCircle className="mr-2 h-4 w-4" />
                          {activeFinanceCategory === "saldo" ? "Toevoegen" : activeFinanceCategory === "boete" ? "Boete geven" : "Betaling verwerken"}
                        </Button>
                        {addMoneyForm.message ? (
                          <div className="rounded-xl bg-[#f3f4f6] px-4 py-3 text-sm text-slate-700">{addMoneyForm.message}</div>
                        ) : null}
                      </div>
                    </div>

                    {activeFinanceCategory === "vaste_lasten" ? (
                      <div className="rounded-xl bg-white p-4 shadow-sm">
                        <div className="space-y-1">
                          <h3 className="text-base font-semibold text-slate-900">Betalingen uit vaste lasten</h3>
                          <p className="text-sm text-slate-500">Geld dat uit de pot is uitgegeven. Dit gaat van het totale saldo af en staat niet op naam van een speler.</p>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                          <div className="space-y-2">
                            <Label htmlFor="pot-payment-amount">Uitgegeven bedrag</Label>
                            <Input
                              id="pot-payment-amount" type="number" step="0.01" value={potPaymentForm.amount}
                              onChange={(e) => setPotPaymentForm((prev) => ({ ...prev, amount: e.target.value, message: "" }))}
                              placeholder="Bijv. 120,00" className="h-12 rounded-xl"
                            />
                          </div>
                          <Button onClick={addPotPayment} disabled={isSavingPotPayment} className="h-12 rounded-xl">
                            <MinusCircle className="mr-2 h-4 w-4" />
                            {isSavingPotPayment ? "Verwerken..." : "Uitgave verwerken"}
                          </Button>
                        </div>
                        {potPaymentForm.message ? (
                          <div className="mt-3 rounded-xl bg-[#f3f4f6] px-4 py-3 text-sm text-slate-700">{potPaymentForm.message}</div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </motion.div>
            ) : activeMainTab === "rijschema" ? (
              <>
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 }} className="space-y-4">
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <div className="grid grid-cols-3 divide-x divide-slate-100 text-center">
                      <div>
                        <p className="text-2xl font-bold tracking-tight text-slate-900">{rideSchedule.length}</p>
                        <p className="text-xs text-slate-500">wedstrijden</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold tracking-tight text-slate-900">{rideScheduleStats.away}</p>
                        <p className="text-xs text-slate-500">uit</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold tracking-tight text-slate-900">{rideScheduleStats.kilometers}</p>
                        <p className="text-xs text-slate-500">km</p>
                      </div>
                    </div>
                  </div>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <h2 className="text-sm font-semibold text-slate-900">Rijschema</h2>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">{rideSchedule.length}</span>
                    </div>
                    <div className="rounded-xl bg-white p-3 shadow-sm">
                      <Label htmlFor="ride-season-filter" className="text-xs uppercase tracking-wide text-slate-500">Seizoen</Label>
                      <select
                        id="ride-season-filter"
                        value={selectedRideSeason}
                        onChange={(e) => setSelectedRideSeason(e.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                      >
                        {rideScheduleSeasons.map((season) => (
                          <option key={season} value={season}>{season}</option>
                        ))}
                      </select>
                    </div>
                    {rideSchedule.length === 0 ? (
                      <div className="rounded-xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm">Nog geen rijschema voor dit seizoen.</div>
                    ) : (
                      <div className="divide-y divide-slate-100 rounded-xl bg-white px-2 shadow-sm">
                        {rideSchedule.map((match) => {
                          const isAway = match.location === "uit";
                          const { day, month } = getRideScheduleDateParts(match.match_date);
                          const isUserRiding = match.riders.some((rider) => isCurrentUserNamed(rider, currentUser));

                          return (
                            <div
                              key={match.id}
                              className={`flex items-center gap-2.5 py-2 ${isUserRiding ? "my-1 rounded-lg bg-slate-900/5 px-2" : "px-1"}`}
                            >
                              <div className={`w-9 shrink-0 rounded-lg py-1 text-center ${isAway ? "bg-slate-900 text-white" : "bg-[#f3f4f6] text-slate-600"}`}>
                                <div className="text-[13px] font-semibold leading-none">{day}</div>
                                <div className="mt-0.5 text-[9px] uppercase leading-none opacity-70">{month}</div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <h3 className="text-[13px] font-semibold leading-tight text-slate-900">{getRideScheduleMatchTitle(match)}</h3>
                                {match.riders.length > 0 ? (
                                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] leading-tight text-slate-500">
                                    {match.riders.map((rider, index) => (
                                      <Fragment key={`${rider}-${index}`}>
                                        <span>{rider}</span>
                                        {index < match.riders.length - 1 ? <span className="text-slate-300">·</span> : null}
                                      </Fragment>
                                    ))}
                                  </p>
                                ) : null}
                              </div>
                              <div className="shrink-0 text-right">
                                <span className={`text-[9px] font-semibold uppercase tracking-wide ${isAway ? "text-slate-900" : "text-slate-400"}`}>{isAway ? "Uit" : "Thuis"}</span>
                                {match.kilometers !== null ? (
                                  <div className="text-[11px] font-medium tabular-nums leading-tight text-slate-500">{match.kilometers} km</div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <h2 className="text-sm font-semibold text-slate-900">Materiaalsletjes</h2>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">{materialDuty.length} maanden · {materialDutyPersonCount} personen</span>
                    </div>
                    {materialDuty.length === 0 ? (
                      <div className="rounded-xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm">Nog geen materiaalsletjes voor dit seizoen.</div>
                    ) : (
                      <div className="divide-y divide-slate-100 rounded-xl bg-white px-2 shadow-sm">
                        {materialDuty.map((duty) => {
                          const isCurrentMonth = duty.season === currentMaterialDutyMonth.season && duty.month === currentMaterialDutyMonth.month;
                          const isUserOnDuty = duty.persons.some((person) => isCurrentUserNamed(person, currentUser));

                          return (
                            <div
                              key={`${duty.season}-${duty.month}`}
                              className={`flex items-center gap-2.5 py-2 ${isUserOnDuty ? "my-1 rounded-lg bg-slate-900/5 px-2" : "px-1"}`}
                            >
                              <div className={`w-9 shrink-0 rounded-lg py-1 text-center ${isCurrentMonth ? "bg-slate-900 text-white" : "bg-[#f3f4f6] text-slate-600"}`}>
                                <div className="text-[13px] font-semibold leading-none">{shortMonths[duty.month - 1] ?? ""}</div>
                                <div className="mt-0.5 text-[9px] uppercase leading-none opacity-70">{getMaterialDutyYear(duty.season, duty.month).slice(-2)}</div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-x-1 text-[13px] font-semibold leading-tight text-slate-900">
                                  {duty.persons.map((person, index) => (
                                    <Fragment key={`${person}-${index}`}>
                                      <span>{person}</span>
                                      {index < duty.persons.length - 1 ? <span className="font-normal text-slate-300">·</span> : null}
                                    </Fragment>
                                  ))}
                                </p>
                              </div>
                              {isCurrentMonth ? (
                                <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">Deze maand</span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </motion.div>
              </>
            ) : activeMainTab === "statistieken" ? (
              <>
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 }} className="space-y-4">
                  <div className="rounded-xl bg-white p-3 shadow-sm">
                    <Label htmlFor="stats-season-filter" className="text-xs uppercase tracking-wide text-slate-500">Seizoen</Label>
                    <select
                      id="stats-season-filter"
                      value={activeStatsSeason}
                      onChange={(e) => setSelectedStatsSeason(e.target.value)}
                      className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                    >
                      <option value={allTimeSeasonValue}>Aller tijden</option>
                      {statsSeasons.map((season) => (
                        <option key={season} value={season}>{season}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {statisticsKpis.map((kpi) => (
                      <button
                        key={kpi.key}
                        type="button"
                        onClick={() => setActiveStatsKpi(kpi.key)}
                        className="relative rounded-xl bg-white p-4 text-left shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
                      >
                        <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-[#f3f4f6] text-slate-500">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </span>
                        <p className="pr-8 text-2xl font-bold tracking-tight text-slate-900">{kpi.value}</p>
                        <p className="mt-1 text-xs text-slate-500">{kpi.label}</p>
                      </button>
                    ))}
                  </div>

                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold text-slate-900">Kas-kanonnen</h3>
                      <span className="text-xs text-slate-500">Totaal opgewaardeerd</span>
                    </div>
                    {spenderChartData.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">Nog geen opwaarderingen beschikbaar.</p>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {spenderChartData.map((spender, index) => {
                          const widthPercent = (spender.total / spenderChartMax) * 100;
                          return (
                            <div key={spender.userId} className="flex items-center gap-3">
                              <span className="w-20 shrink-0 truncate text-xs font-medium text-slate-700">{spender.username}</span>
                              <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#f3f4f6]">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${widthPercent}%` }}
                                  transition={{ duration: 0.5, delay: index * 0.03 }}
                                  className={`h-full rounded-full ${index === 0 ? "bg-slate-900" : "bg-slate-300"}`}
                                />
                              </div>
                              <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-900">{euro(spender.total)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <h3 className="text-base font-semibold text-slate-900">Opwaarderingen per maand</h3>
                    {statistics.monthlyTotals.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">Nog geen opwaarderingen beschikbaar.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {statistics.monthlyTotals.map((item) => {
                          const isExpanded = expandedStatMonths.includes(item.key);
                          return (
                            <div key={item.key} className="rounded-lg bg-[#f3f4f6]">
                              <button
                                type="button"
                                onClick={() => setExpandedStatMonths((prev) => prev.includes(item.key) ? prev.filter((k) => k !== item.key) : [...prev, item.key])}
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                              >
                                <span className="flex-1 text-sm text-slate-700">{item.label}</span>
                                <span className="text-sm font-semibold text-slate-900">{euro(item.total)}</span>
                                <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                              </button>
                              {isExpanded ? (
                                <div className="space-y-1.5 border-t border-slate-200 px-3 pb-2.5 pt-2">
                                  {item.perUserTotals.map((person) => (
                                    <div key={`${item.key}-${person.userId}`} className="flex items-center justify-between text-sm">
                                      <span className="text-slate-600">{person.name}</span>
                                      <span className="font-medium text-slate-900">{euro(person.total)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <h3 className="text-base font-semibold text-slate-900">Uitgaven per datum</h3>
                    {statistics.dailyExpenses.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">Nog geen uitgaven beschikbaar.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {statistics.dailyExpenses.map((item) => {
                          const isExpanded = expandedStatDates.includes(item.key);
                          return (
                            <div key={item.key} className="rounded-lg bg-[#f3f4f6]">
                              <button
                                type="button"
                                onClick={() => setExpandedStatDates((prev) => prev.includes(item.key) ? prev.filter((k) => k !== item.key) : [...prev, item.key])}
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                              >
                                <span className="flex-1 text-sm text-slate-700">{item.label}</span>
                                <span className="text-sm font-semibold text-slate-900">{euro(item.total)}</span>
                                <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                              </button>
                              {isExpanded ? (
                                <div className="space-y-1.5 border-t border-slate-200 px-3 pb-2.5 pt-2">
                                  {item.perUserTotals.map((person) => (
                                    <div key={`${item.key}-${person.userId}`} className="flex items-center justify-between text-sm">
                                      <span className="text-slate-600">{person.name}</span>
                                      <span className="font-medium text-slate-900">{euro(person.total)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
                {devUsageSection}
              </>
            ) : null}
          </>
        )}
      </div>

      {isPasswordModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => { if (isSavingPassword) return; setIsPasswordModalOpen(false); }}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Wachtwoord wijzigen</h2>
                <p className="mt-1 text-sm text-slate-500">Vul je huidige wachtwoord in en kies daarna een nieuw wachtwoord.</p>
              </div>
              <form onSubmit={changePassword} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Huidig wachtwoord</Label>
                  <Input id="current-password" type="password" value={currentPasswordForChange} onChange={(e) => { setCurrentPasswordForChange(e.target.value); setPasswordMessage(""); }} placeholder="Je huidige wachtwoord" className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nieuw wachtwoord</Label>
                  <Input id="new-password" type="password" value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setPasswordMessage(""); }} placeholder="Minimaal 8 tekens" className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-new-password">Herhaal nieuw wachtwoord</Label>
                  <Input id="confirm-new-password" type="password" value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setPasswordMessage(""); }} placeholder="Herhaal je nieuwe wachtwoord" className="h-11 rounded-xl" />
                </div>
                {passwordMessage ? <p className="text-sm text-slate-600">{passwordMessage}</p> : null}
                <div className="space-y-2 pt-1">
                  <Button type="submit" className="w-full rounded-xl" disabled={isSavingPassword}>{isSavingPassword ? "Opslaan..." : "Opslaan"}</Button>
                  <Button type="button" variant="outline" className="w-full rounded-xl" disabled={isSavingPassword} onClick={() => setIsPasswordModalOpen(false)}>Annuleren</Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {isFixedChargeModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setIsFixedChargeModalOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-slate-900">Post aanmaken of verwijderen</h2>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="fixed-charge-name">Naam</Label>
                  <Input
                    id="fixed-charge-name" value={fixedChargeForm.name}
                    onChange={(e) => setFixedChargeForm((prev) => ({ ...prev, name: e.target.value, message: "" }))}
                    placeholder="Bijv. Vaste lasten najaar 2026" className="h-12 rounded-xl"
                  />
                </div>
                <Button onClick={createFixedCharge} disabled={isSavingFixedCharge} className="h-12 rounded-xl">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {isSavingFixedCharge ? "Aanmaken..." : "Aanmaken"}
                </Button>
              </div>
              {fixedChargeForm.message ? (
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{fixedChargeForm.message}</div>
              ) : null}
              {fixedCharges.length > 0 ? (
                <div className="space-y-2">
                  <Label>Bestaande posten</Label>
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {fixedCharges.map((charge) => {
                      const transactionCount = fixedChargeTransactionCounts.get(charge.id) ?? 0;
                      const isDeleting = deletingFixedChargeId === charge.id;
                      return (
                        <div key={charge.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{charge.name}</p>
                            <p className="text-sm text-slate-500">
                              {transactionCount === 0 ? "Nog geen transacties" : `${transactionCount} ${transactionCount === 1 ? "transactie" : "transacties"}`}
                              {" · "}aangemaakt op {formatDate(charge.created_at)}
                            </p>
                          </div>
                          <Button
                            type="button" variant="outline" className="shrink-0 rounded-xl"
                            disabled={transactionCount > 0 || isDeleting}
                            onClick={() => deleteFixedCharge(charge)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {isDeleting ? "Bezig..." : "Verwijderen"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <Button type="button" variant="outline" className="w-full rounded-xl" onClick={() => setIsFixedChargeModalOpen(false)}>Sluiten</Button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddUserModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => { if (isSavingUser) return; setIsAddUserModalOpen(false); }}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Gebruiker toevoegen</h2>
                <p className="mt-1 text-sm text-slate-500">De nieuwe gebruiker logt in met zijn gebruikersnaam en start op een saldo van € 0,00.</p>
              </div>
              <form onSubmit={createUser} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="new-user-username">Gebruikersnaam</Label>
                  <Input id="new-user-username" value={addUserForm.username} onChange={(e) => { setAddUserForm((prev) => ({ ...prev, username: e.target.value })); setAddUserMessage(""); }} placeholder="gebruikersnaam" autoCapitalize="none" autoComplete="off" className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-user-name">Volledige naam</Label>
                  <Input id="new-user-name" value={addUserForm.name} onChange={(e) => { setAddUserForm((prev) => ({ ...prev, name: e.target.value })); setAddUserMessage(""); }} placeholder="volledige naam" autoComplete="off" className="h-11 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-user-password">Wachtwoord</Label>
                  <Input id="new-user-password" type="password" value={addUserForm.password} onChange={(e) => { setAddUserForm((prev) => ({ ...prev, password: e.target.value })); setAddUserMessage(""); }} placeholder="Minimaal 8 tekens" autoComplete="new-password" className="h-11 rounded-xl" />
                </div>
                {addUserMessage ? <p className="text-sm text-slate-600">{addUserMessage}</p> : null}
                <div className="space-y-2 pt-1">
                  <Button type="submit" className="w-full rounded-xl" disabled={isSavingUser}>{isSavingUser ? "Toevoegen..." : "Toevoegen"}</Button>
                  <Button type="button" variant="outline" className="w-full rounded-xl" disabled={isSavingUser} onClick={() => setIsAddUserModalOpen(false)}>Sluiten</Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {selectedUser ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-4 sm:items-center">
          <motion.div
            ref={userModalRef}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <span className="rounded-full bg-[#f3f4f6] px-2.5 py-1 text-xs font-medium text-slate-600">{getRoleLabel(selectedUser.role)}</span>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f3f4f6] text-slate-700 transition hover:bg-slate-200"
                aria-label="Sluiten"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1 text-center">
              <UserAvatar name={selectedUser.name} avatar={getAvatarForUser(selectedUser)} className="mx-auto h-48 w-48 ring-4 ring-[#f3f4f6]" fallbackClassName="text-4xl" />
              <p className="mt-3 text-lg font-semibold text-slate-900">{selectedUser.name}</p>
              <p className="text-sm text-slate-500">@{selectedUser.username}</p>
            </div>
            <div className={`mt-5 grid gap-3 ${activeFinanceCategory === "saldo" ? "grid-cols-2" : "grid-cols-1"}`}>
              <div className="rounded-xl bg-[#f3f4f6] p-4">
                <p className="text-xs text-slate-500">{activeFinanceCategory === "saldo" ? "Huidig saldo" : activeFinanceCategory === "boete" ? "Openstaande boetes" : "Betaald voor deze post"}</p>
                <p className={`mt-1 text-xl font-bold tracking-tight ${activeFinanceCategory === "boete" && selectedUser.balance > 0 ? "text-red-600" : "text-slate-900"}`}>
                  {euro(selectedUser.balance)}
                </p>
              </div>
              {activeFinanceCategory === "saldo" ? (
                <div className="rounded-xl bg-[#f3f4f6] p-4">
                  <p className="text-xs text-slate-500">Totaal uitgegeven</p>
                  <p className="mt-1 text-xl font-bold tracking-tight text-slate-900">{euro(allTimePositivePerUser.get(selectedUser.id) ?? 0)}</p>
                </div>
              ) : null}
            </div>
            {selectedUserTransactions.length > 0 ? (
              <div className="mt-4">
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Laatste transacties</p>
                <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {selectedUserTransactions.map((transaction) => {
                    const isBoete = transaction.category === "boete";
                    return (
                      <div key={transaction.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{getTransactionKindLabel(transaction)}</p>
                          <p className="text-xs text-slate-500">{formatDate(transaction.created_at)}</p>
                        </div>
                        <p className={`shrink-0 text-sm font-semibold ${isBoete ? "text-red-600" : "text-slate-900"}`}>
                          {!isBoete && transaction.amount_change > 0 ? "+" : ""}{euro(transaction.amount_change)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}

      {activeStatsKpi ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-4 sm:items-center" onClick={() => setActiveStatsKpi(null)}>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{statsKpiDetailTitles[activeStatsKpi].title}</h2>
                <p className="mt-0.5 text-sm text-slate-500">{statsKpiDetailTitles[activeStatsKpi].description}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveStatsKpi(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-slate-700 transition hover:bg-slate-200"
                aria-label="Sluiten"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {activeStatsKpi === "average" ? (
              statisticsDetails.histogram.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Nog geen opwaarderingen beschikbaar.</p>
              ) : (
                <div className="mt-5">
                  <div className="flex h-44 items-end gap-1.5">
                    {statisticsDetails.histogram.map((bucket, index) => {
                      const isAverageBucket = index === statisticsDetails.averageBucketIndex;
                      const heightPercent = (bucket.count / statisticsDetails.histogramMax) * 100;
                      return (
                        <div key={bucket.from} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                          <span className={`text-[11px] font-semibold tabular-nums ${isAverageBucket ? "text-slate-900" : "text-slate-500"}`}>{bucket.count}</span>
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: `${Math.max(heightPercent, 3)}%` }}
                            transition={{ duration: 0.45, delay: index * 0.04 }}
                            className={`w-full rounded-md ${isAverageBucket ? "bg-slate-900" : "bg-[#f3f4f6]"}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex gap-1.5 border-t border-slate-100 pt-2">
                    {statisticsDetails.histogram.map((bucket, index) => (
                      <span key={bucket.from} className={`min-w-0 flex-1 truncate text-center text-[10px] tabular-nums ${index === statisticsDetails.averageBucketIndex ? "font-semibold text-slate-900" : "text-slate-500"}`}>
                        {bucket.from}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-center text-xs text-slate-500">
                    Elke kolom is een bucket van {euro(statisticsDetails.bucketSize)}, het label is de ondergrens. De zwarte kolom bevat het gemiddelde van {euro(statistics.averageTopUp)}.
                  </p>
                </div>
              )
            ) : (
              <div className="mt-4 space-y-2">
                {statsKpiRanking.length === 0 ? (
                  <p className="text-sm text-slate-500">Nog geen opwaarderingen beschikbaar.</p>
                ) : (
                  statsKpiRanking.map((row, index) => (
                    <div key={row.userId} className="flex items-center gap-3 rounded-lg bg-[#f3f4f6] px-3 py-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-600">{index + 1}</span>
                      <UserAvatar name={row.name} avatar={row.user ? getAvatarForUser(row.user) : ""} className="h-9 w-9 shrink-0" />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{row.name}</p>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                        {activeStatsKpi === "count" ? `${row.count}×` : activeStatsKpi === "total" ? euro(row.total) : euro(row.largest)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </motion.div>
        </div>
      ) : null}

      {isProfilePageOpen ? null : (
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid w-full max-w-md grid-cols-3 py-3">
          <button onClick={() => setActiveMainTab("saldo")} className="flex w-full flex-col items-center justify-center">
            <Wallet className={`transition ${activeMainTab === "saldo" ? "h-6 w-6 text-slate-900" : "h-5 w-5 text-slate-400"}`} />
            <span className={`mt-1 text-xs ${activeMainTab === "saldo" ? "text-slate-900 font-medium" : "text-slate-400"}`}>Saldo</span>
          </button>
          <button onClick={() => setActiveMainTab("rijschema")} className="flex w-full flex-col items-center justify-center">
            <CalendarDays className={`transition ${activeMainTab === "rijschema" ? "h-6 w-6 text-slate-900" : "h-5 w-5 text-slate-400"}`} />
            <span className={`mt-1 text-xs ${activeMainTab === "rijschema" ? "text-slate-900 font-medium" : "text-slate-400"}`}>Schema</span>
          </button>
          <button onClick={() => setActiveMainTab("statistieken")} className="flex w-full flex-col items-center justify-center">
            <BarChart3 className={`transition ${activeMainTab === "statistieken" ? "h-6 w-6 text-slate-900" : "h-5 w-5 text-slate-400"}`} />
            <span className={`mt-1 text-xs ${activeMainTab === "statistieken" ? "text-slate-900 font-medium" : "text-slate-400"}`}>Statistieken</span>
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
