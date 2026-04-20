"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogOut, ShieldCheck, Wallet, PlusCircle, Car, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";

type User = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "user";
  balance: number;
  avatar: string;
};

type AddMoneyFormState = {
  selectedUserIds: string[];
  amount: string;
  message: string;
};

type RideScheduleItem = {
  date: string;
  team: string;
  location: "uit" | "thuis" | "Thuis";
  kilometers: number | null;
  riders: string[];
};

type Transaction = {
  id: string;
  created_at: string;
  user_id: string;
  name: string;
  amount_change: number;
};

const rideSchedule: RideScheduleItem[] = [
  {
    date: "1/3/2026",
    team: "tilburg H7",
    location: "uit",
    kilometers: 34,
    riders: ["sewi", "bram", "olivier", "hugo"],
  },
  {
    date: "8/3/2026",
    team: "Don Quishoot H3",
    location: "uit",
    kilometers: 37,
    riders: ["brek", "jonathan", "joost", "max"],
  },
  {
    date: "15/3/2026",
    team: "Push H3",
    location: "thuis",
    kilometers: null,
    riders: [],
  },
  {
    date: "22/3/2026",
    team: "Push H4",
    location: "uit",
    kilometers: 21,
    riders: ["pepijn", "sewi", "timon", "tim"],
  },
  {
    date: "29/3/2026",
    team: "Rosmalen",
    location: "thuis",
    kilometers: null,
    riders: [],
  },
  {
    date: "12/4/2026",
    team: "Were Di H4",
    location: "uit",
    kilometers: 26,
    riders: ["tijn", "pepijn", "hugo", "pieter"],
  },
  {
    date: "19/4/2026",
    team: "Drunen",
    location: "Thuis",
    kilometers: null,
    riders: [],
  },
  {
    date: "10/5/2026",
    team: "Best",
    location: "Thuis",
    kilometers: null,
    riders: [],
  },
  {
    date: "17/5/2026",
    team: "Geel-Zwart",
    location: "uit",
    kilometers: 21,
    riders: ["tim", "timon", "pieter", "jonathan"],
  },
  {
    date: "31/5/2026",
    team: "Den Bosch",
    location: "thuis",
    kilometers: null,
    riders: [],
  },
  {
    date: "7/6/2026",
    team: "Oranje-Rood",
    location: "uit",
    kilometers: 43,
    riders: ["sam", "tom", "bas", "thomas"],
  },
  {
    date: "14/6/2026",
    team: "tilburg H7",
    location: "thuis",
    kilometers: null,
    riders: [],
  },
];

function euro(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}:${ss}`;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .join("")
    .slice(0, 2);
}

const authEmailDomain = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? "saldo.local";

function sanitizeUsername(username: string) {
  return username
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 48);
}

function usernameToAuthEmail(username: string) {
  const safe = sanitizeUsername(username);
  return `${safe}@${authEmailDomain}`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export default function SaldoTrackerApp() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [activeMainTab, setActiveMainTab] = useState<"saldo" | "rijschema" | "statistieken">("saldo");
  const [addMoneyForm, setAddMoneyForm] = useState<AddMoneyFormState>({
    selectedUserIds: [],
    amount: "",
    message: "",
  });
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPasswordForChange, setCurrentPasswordForChange] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const userModalRef = useRef<HTMLDivElement | null>(null);

  const loadCurrentUser = async (userId: string) => {
    const { data, error: currentUserError } = await supabase
      .from("users")
      .select("id, username, name, role, balance, avatar")
      .eq("id", userId)
      .maybeSingle();

    if (currentUserError) {
      console.error("Fout bij ophalen huidige gebruiker:", currentUserError);
      return null;
    }

    if (!data) {
      console.error("Geen profiel gevonden voor auth gebruiker.");
      return null;
    }

    setCurrentUser(data);
    return data;
  };

  const refreshUsers = async () => {
    const { data, error } = await supabase
      .from("users")
      .select("id, username, name, role, balance, avatar");

    if (error) {
      console.error("Fout bij verversen users:", error);
      return;
    }

    if (data) setUsers(data);

    const { data: transactionData, error: transactionError } = await supabase
      .from("transactions")
      .select("id, created_at, user_id, name, amount_change")
      .order("created_at", { ascending: false });

    if (transactionError) {
      console.error("Fout bij ophalen transacties:", transactionError);
      return;
    }

    if (transactionData) setTransactions(transactionData);
  };
  
  useEffect(() => {
    function handleClickOutsideModal(event: MouseEvent) {
      if (
        userModalRef.current &&
        !userModalRef.current.contains(event.target as Node)
      ) {
        setSelectedUser(null);
      }
    }

    if (selectedUser) {
      document.addEventListener("mousedown", handleClickOutsideModal);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutsideModal);
    };
  }, [selectedUser]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setIsProfileMenuOpen(false);
      }
    }

    if (isProfileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    let isMounted = true;

    const bootstrapSession = async () => {
      try {
        const { data, error: sessionError } = await withTimeout(
          supabase.auth.getSession(),
          8000,
          "getSession"
        );

        if (sessionError) {
          console.error("Fout bij ophalen sessie:", sessionError);
        }

        const authUserId = data.session?.user.id;
        if (!authUserId) {
          if (!isMounted) return;
          setCurrentUser(null);
          setUsers([]);
          setTransactions([]);
          return;
        }

        const profile = await withTimeout(loadCurrentUser(authUserId), 8000, "loadCurrentUser");
        if (profile) {
          void refreshUsers();
        } else {
          await supabase.auth.signOut();
        }
      } catch (bootstrapError) {
        console.error("Fout tijdens sessie-initialisatie:", bootstrapError);
      } finally {
        if (isMounted) {
          setIsAuthLoading(false);
        }
      }
    };

    void bootstrapSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!session?.user?.id) {
          if (!isMounted) return;
          setCurrentUser(null);
          setUsers([]);
          setTransactions([]);
          setIsAuthLoading(false);
          return;
        }

        const profile = await loadCurrentUser(session.user.id);
        if (profile) {
          await refreshUsers();
          setError("");
        }

        if (isMounted) {
          setIsAuthLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    const handleAppVisible = () => {
      void refreshUsers();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshUsers();
      }
    };

    window.addEventListener("focus", handleAppVisible);
    window.addEventListener("pageshow", handleAppVisible);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleAppVisible);
      window.removeEventListener("pageshow", handleAppVisible);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentUser]);


  const sortedUsers = useMemo(() => {
    return [...users]
      .filter((user) => user.role !== "admin")
      .sort((a, b) => b.balance - a.balance);
  }, [users]);

  const totalBalance = useMemo(() => {
    return users
      .filter((user) => user.role !== "admin")
      .reduce((sum, user) => sum + user.balance, 0);
  }, [users]);

  const statistics = useMemo(() => {
    const positiveTransactions = transactions.filter((t) => t.amount_change > 0);
    const totalTopUps = positiveTransactions.reduce(
      (sum, t) => sum + t.amount_change,
      0
    );
    const averageTopUp =
      positiveTransactions.length > 0 ? totalTopUps / positiveTransactions.length : 0;
    const largestTopUp =
      positiveTransactions.length > 0
        ? Math.max(...positiveTransactions.map((t) => t.amount_change))
        : 0;

    const topUpsByUser = new Map<string, number>();
    for (const t of positiveTransactions) {
      topUpsByUser.set(t.user_id, (topUpsByUser.get(t.user_id) ?? 0) + t.amount_change);
    }

    const topSpenders = Array.from(topUpsByUser.entries())
      .map(([userId, total]) => ({
        userId,
        total,
        name: users.find((u) => u.id === userId)?.name ?? "Onbekend",
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

    const monthLabels = [
      "jan",
      "feb",
      "mrt",
      "apr",
      "mei",
      "jun",
      "jul",
      "aug",
      "sep",
      "okt",
      "nov",
      "dec",
    ];

    const monthlyTotalsMap = new Map<string, { label: string; total: number; sort: number }>();
    for (const t of positiveTransactions) {
      const d = new Date(t.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${monthLabels[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`;
      const sort = d.getFullYear() * 100 + (d.getMonth() + 1);
      const existing = monthlyTotalsMap.get(key);
      if (existing) {
        existing.total += t.amount_change;
      } else {
        monthlyTotalsMap.set(key, { label, total: t.amount_change, sort });
      }
    }

    const monthlyTotals = Array.from(monthlyTotalsMap.values())
      .sort((a, b) => b.sort - a.sort)
      .slice(0, 6);

    return {
      positiveCount: positiveTransactions.length,
      totalTopUps,
      averageTopUp,
      largestTopUp,
      topSpenders,
      monthlyTotals,
    };
  }, [transactions, users]);

  const totalPositivePerUser = useMemo(() => {
    const totals = new Map<string, number>();

    for (const transaction of transactions) {
      if (transaction.amount_change <= 0) continue;
      totals.set(
        transaction.user_id,
        (totals.get(transaction.user_id) ?? 0) + transaction.amount_change
      );
    }

    return totals;
  }, [transactions]);

const login = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password.trim()) {
      setError("Vul gebruikersnaam en wachtwoord in.");
      return;
    }

    const safeUsername = sanitizeUsername(normalizedUsername);
    if (!safeUsername) {
      setError("Vul een geldige gebruikersnaam in.");
      return;
    }

    const email = usernameToAuthEmail(safeUsername);

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setError("Onjuiste gebruikersnaam of wachtwoord.");
      return;
    }

    setError("");
    setUsername("");
    setPassword("");
  };

  const logout = async () => {
    const { error: logoutError } = await supabase.auth.signOut({ scope: "local" });
    if (logoutError) {
      console.error("Fout bij uitloggen:", logoutError);
    }

    setCurrentUser(null);
    setUsers([]);
    setTransactions([]);
    setIsProfileMenuOpen(false);
    setIsPasswordModalOpen(false);
  };

  const updateCurrentUserAvatar = async (avatar: string) => {
    if (!currentUser) return;

    const { error } = await supabase
      .from("users")
      .update({ avatar })
      .eq("id", currentUser.id);

    if (error) {
      console.error("Fout bij opslaan avatar:", error);
      return;
    }

    setUsers((prev) =>
      prev.map((user) =>
        user.id === currentUser.id ? { ...user, avatar } : user
      )
    );

    setCurrentUser((prev) => (prev ? { ...prev, avatar } : prev));
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async () => {
      const result = reader.result;
      if (typeof result === "string") {
        await updateCurrentUserAvatar(result);
        setIsProfileMenuOpen(false);
      }
    };

    reader.readAsDataURL(file);

    e.target.value = "";
  };

  const removeAvatar = async () => {
    if (!currentUser) return;

    const { error } = await supabase
      .from("users")
      .update({ avatar: "" })
      .eq("id", currentUser.id);

    if (error) {
      console.error("Fout bij verwijderen avatar:", error);
      return;
    }

    setUsers((prev) =>
      prev.map((user) =>
        user.id === currentUser.id ? { ...user, avatar: "" } : user
      )
    );

    setCurrentUser((prev) => (prev ? { ...prev, avatar: "" } : prev));
    setIsProfileMenuOpen(false);
  };

  const changePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordMessage("");

    if (!currentPasswordForChange) {
      setPasswordMessage("Vul je huidige wachtwoord in.");
      return;
    }

    if (newPassword.length < 8) {
      setPasswordMessage("Wachtwoord moet minimaal 8 tekens zijn.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage("Wachtwoorden komen niet overeen.");
      return;
    }

    setIsSavingPassword(true);

    const {
      data: { user: authUser },
      error: authUserError,
    } = await supabase.auth.getUser();

    if (authUserError || !authUser?.email) {
      setIsSavingPassword(false);
      setPasswordMessage("Kon je account niet verifiëren. Log opnieuw in.");
      return;
    }

    const { error: reAuthError } = await supabase.auth.signInWithPassword({
      email: authUser.email,
      password: currentPasswordForChange,
    });

    if (reAuthError) {
      setIsSavingPassword(false);
      setPasswordMessage("Huidig wachtwoord is onjuist.");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    setIsSavingPassword(false);

    if (updateError) {
      setPasswordMessage("Wachtwoord wijzigen mislukt. Probeer opnieuw.");
      console.error("Fout bij wachtwoord wijzigen:", updateError);
      return;
    }

    setCurrentPasswordForChange("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMessage("Wachtwoord succesvol gewijzigd.");
  };

  const toggleSelectedUser = (id: string) => {
    setAddMoneyForm((prev) => ({
      ...prev,
      selectedUserIds: prev.selectedUserIds.includes(id)
        ? prev.selectedUserIds.filter((userId) => userId !== id)
        : [...prev.selectedUserIds, id],
      message: "",
    }));
  };

  const addMoneyToSelectedUsers = async () => {
    const parsedAmount = Number(addMoneyForm.amount.replace(",", "."));

    if (addMoneyForm.selectedUserIds.length === 0) {
      setAddMoneyForm((prev) => ({
        ...prev,
        message: "Selecteer minstens 1 gebruiker.",
      }));
      return;
    }

    if (!Number.isFinite(parsedAmount)) {
      setAddMoneyForm((prev) => ({
        ...prev,
        message: "Vul een geldig bedrag in.",
      }));
      return;
    }

    for (const userId of addMoneyForm.selectedUserIds) {
      const user = users.find((u) => u.id === userId);
      if (!user) continue;

      const newBalance = Number((user.balance + parsedAmount).toFixed(2));

      const { error: updateError } = await supabase
        .from("users")
        .update({ balance: newBalance })
        .eq("id", userId);

      if (updateError) {
        setAddMoneyForm((prev) => ({
          ...prev,
          message: "Saldo opslaan mislukt.",
        }));
        return;
      }

      const { error: transactionError } = await supabase
        .from("transactions")
        .insert({
          user_id: user.id,
          name: user.name,
          amount_change: parsedAmount,
        });

      if (transactionError) {
        setAddMoneyForm((prev) => ({
          ...prev,
          message: "Transactie opslaan mislukt.",
        }));
        return;
      }
    }

    await refreshUsers();

    setAddMoneyForm({
      selectedUserIds: [],
      amount: "",
      message: `€ ${parsedAmount.toFixed(2)} toegevoegd aan ${addMoneyForm.selectedUserIds.length} gebruiker(s).`,
    });
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4 md:p-8">
        <div className="mx-auto flex min-h-[85vh] max-w-md items-center justify-center">
          <Card className="w-full rounded-3xl border-0 shadow-xl">
            <CardContent className="flex items-center justify-center gap-3 py-12 text-slate-600">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span>Sessie controleren...</span>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4 md:p-8">
        <div className="mx-auto flex min-h-[85vh] max-w-md items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="w-full"
          >
            <Card className="rounded-3xl border-0 shadow-xl">
              <CardHeader className="space-y-3 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
                  <Wallet className="h-7 w-7" />
                </div>
                <div>
                  <CardTitle className="text-2xl font-bold">Saldo Tracker</CardTitle>
                  <p className="mt-2 text-sm text-slate-500">
                    Log in om de teamsaldo&apos;s te bekijken.
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={login} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Gebruikersnaam</Label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Je gebruikersnaam"
                      className="h-12 rounded-2xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Wachtwoord</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Je wachtwoord"
                      className="h-12 rounded-2xl"
                    />
                  </div>

                  {error ? (
                    <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
                      {error}
                    </div>
                  ) : null}

                  <Button type="submit" className="h-12 w-full rounded-2xl text-base">
                    Inloggen
                  </Button>
                </form>

                <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  <p className="font-medium text-slate-800">Versie 1.0.9</p>
                  <div className="mt-2 space-y-1">
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-3 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:p-4 sm:pb-[calc(7rem+env(safe-area-inset-bottom))] md:p-8 md:pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="overflow-visible rounded-3xl border-0 shadow-sm">
            <CardContent className="overflow-visible flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between md:p-6">
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                    className="rounded-full"
                  >
                    <Avatar className="h-12 w-12 ring-2 ring-white shadow">
                      {currentUser.avatar ? (
                        <AvatarImage src={currentUser.avatar} alt={currentUser.name} />
                      ) : null}
                      <AvatarFallback>{getInitials(currentUser.name)}</AvatarFallback>
                    </Avatar>
                  </button>

                  {isProfileMenuOpen ? (
                    <div
                      ref={profileMenuRef}
                      className="absolute left-0 top-14 z-50 mt-2 w-[280px] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
                    >
                      <div className="space-y-3">
                        <div>
                          <p className="font-semibold text-slate-900">Profielfoto aanpassen</p>
                          <p className="text-sm text-slate-500">
                            Upload een foto of verwijder je huidige profielfoto.
                          </p>
                        </div>

                        <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
                          <Avatar className="h-14 w-14">
                            {currentUser.avatar ? (
                              <AvatarImage src={currentUser.avatar} alt={currentUser.name} />
                            ) : null}
                            <AvatarFallback>{getInitials(currentUser.name)}</AvatarFallback>
                          </Avatar>

                          <div className="min-w-0 text-sm text-slate-600">
                            <p className="truncate font-medium text-slate-900">{currentUser.name}</p>
                            <p>Klik hieronder om een foto te kiezen.</p>
                          </div>
                        </div>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleAvatarUpload}
                          className="hidden"
                        />

                        <div className="flex flex-col gap-2">
                          <Button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="rounded-2xl"
                          >
                            Foto uploaden
                          </Button>

                          <Button
                            type="button"
                            variant="outline"
                            onClick={removeAvatar}
                            className="rounded-2xl"
                          >
                            Profielfoto verwijderen
                          </Button>
                        </div>

                        <div className="border-t border-slate-200 pt-3">
                          <p className="font-semibold text-slate-900">Wachtwoord wijzigen</p>
                          <Button
                            type="button"
                            variant="outline"
                            className="mt-3 w-full rounded-2xl"
                            onClick={() => {
                              setPasswordMessage("");
                              setCurrentPasswordForChange("");
                              setNewPassword("");
                              setConfirmPassword("");
                              setIsProfileMenuOpen(false);
                              setIsPasswordModalOpen(true);
                            }}
                          >
                            wachtwoord wijzigen
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div>
                  <h1 className="text-xl font-semibold sm:text-2xl">Welkom, {currentUser.name}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full">
                      {currentUser.role === "admin" ? "Admin" : "Gebruiker"}
                    </Badge>
                    <span className="text-sm text-slate-500">Teaminformatie heren 6</span>
                  </div>
                </div>
              </div>

              <Button type="button" variant="outline" onClick={logout} className="rounded-2xl">
                <LogOut className="mr-2 h-4 w-4" />
                Uitloggen
              </Button>
            </CardContent>
          </Card>
        </motion.div>
        {activeMainTab === "saldo" ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05 }}
          >
            <Card className="rounded-3xl border-0 shadow-sm">
              <Tabs defaultValue="overzicht" className="w-full">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="text-xl">Saldo</CardTitle>
                      <p className="mt-1 text-sm text-slate-500">
                        Teamsaldo totaal: {euro(totalBalance)}
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:items-end">
                      {currentUser.role === "admin" ? (
                        <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">
                          <ShieldCheck className="mr-1 h-4 w-4" />
                          Admin kan saldo&apos;s aanpassen
                        </Badge>
                      ) : null}

                      <TabsList
                        className={`grid rounded-2xl w-full ${
                          currentUser.role === "admin"
                            ? "grid-cols-3 sm:w-[420px]"
                            : "grid-cols-2 sm:w-[300px]"
                        }`}
                      >
                        <TabsTrigger value="overzicht">Overzicht</TabsTrigger>
                        <TabsTrigger value="transacties">Transacties</TabsTrigger>
                        {currentUser.role === "admin" ? (
                          <TabsTrigger value="toevoegen">Saldo aanpassen</TabsTrigger>
                        ) : null}
                      </TabsList>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <TabsContent value="overzicht" className="mt-0">
                    <div className="overflow-hidden rounded-2xl border bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Profiel</TableHead>
                            <TableHead>Naam</TableHead>
                            <TableHead className="text-right">Saldo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedUsers.map((user) => (
                            <TableRow key={user.id}>
                              <TableCell>
                                <button
                                  type="button"
                                  onClick={() => setSelectedUser(user)}
                                  className="rounded-full"
                                >
                                  <Avatar className="h-11 w-11 cursor-pointer transition hover:scale-105">
                                    {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
                                    <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                                  </Avatar>
                                </button>
                              </TableCell>
                              <TableCell className="font-medium">{user.name}</TableCell>
                              <TableCell className="text-right font-semibold">
                                <span className={user.balance >= 0 ? "text-slate-900" : "text-red-600"}>
                                  {euro(user.balance)}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>
                  <TabsContent value="transacties" className="mt-0">
                    <div className="overflow-hidden rounded-2xl border bg-white">
                      <div className="max-h-[420px] overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Datum/tijd</TableHead>
                              <TableHead>Naam</TableHead>
                              <TableHead className="text-right">Verandering</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {transactions.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={3} className="text-center text-slate-500">
                                  Nog geen transacties.
                                </TableCell>
                              </TableRow>
                            ) : (
                              transactions.map((transaction) => (
                                <TableRow key={transaction.id}>
                                  <TableCell>{formatDateTime(transaction.created_at)}</TableCell>
                                  <TableCell className="font-medium">{transaction.name}</TableCell>
                                  <TableCell className="text-right font-semibold">
                                    <span
                                      className={
                                        transaction.amount_change >= 0
                                          ? "text-green-600"
                                          : "text-red-600"
                                      }
                                    >
                                      {transaction.amount_change >= 0 ? "+" : ""}
                                      {euro(transaction.amount_change)}
                                    </span>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </TabsContent>
                  {currentUser.role === "admin" ? (
                    <TabsContent value="toevoegen" className="mt-0">
                      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                        <Card className="rounded-2xl border shadow-none">
                          <CardContent className="p-5">
                            <div className="space-y-2">
                              <h3 className="text-lg font-semibold">Saldo aanpassen</h3>
                              <p className="text-sm text-slate-500">
                                Selecteer 1 of meerdere gebruikers en voeg in één keer hetzelfde bedrag toe.
                              </p>
                            </div>

                            <div className="mt-5 space-y-4">
                              <div className="space-y-2">
                                <Label>Gebruikers selecteren</Label>
                                <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border p-3">
                                  {sortedUsers.map((user) => {
                                    const selected = addMoneyForm.selectedUserIds.includes(user.id);

                                    return (
                                      <button
                                        key={user.id}
                                        type="button"
                                        onClick={() => toggleSelectedUser(user.id)}
                                        className={`flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition ${
                                          selected
                                            ? "border-slate-900 bg-slate-900 text-white"
                                            : "border-slate-200 bg-white hover:bg-slate-50"
                                        }`}
                                      >
                                        <div className="flex items-center gap-3">
                                          <Avatar className="h-10 w-10">
                                            {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
                                            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                                          </Avatar>
                                          <div>
                                            <p className="font-medium">{user.name}</p>
                                            <p className={`text-sm ${selected ? "text-slate-200" : "text-slate-500"}`}>
                                              Huidig saldo: {euro(user.balance)}
                                            </p>
                                          </div>
                                        </div>

                                        <div
                                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                            selected
                                              ? "bg-white text-slate-900"
                                              : "bg-slate-100 text-slate-600"
                                          }`}
                                        >
                                          {selected ? "Geselecteerd" : "Selecteer"}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div className="space-y-2">
                                <Label htmlFor="amount">Bedrag</Label>
                                <Input
                                  id="amount"
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={addMoneyForm.amount}
                                  onChange={(e) =>
                                    setAddMoneyForm((prev) => ({
                                      ...prev,
                                      amount: e.target.value,
                                      message: "",
                                    }))
                                  }
                                  placeholder="Bijv. 10,50"
                                  className="h-12 rounded-2xl"
                                />
                              </div>

                              <Button onClick={addMoneyToSelectedUsers} className="h-12 rounded-2xl">
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Toevoegen
                              </Button>

                              {addMoneyForm.message ? (
                                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                                  {addMoneyForm.message}
                                </div>
                              ) : null}
                            </div>
                          </CardContent>
                        </Card>

                        <Card className="rounded-2xl border shadow-none">
                          <CardContent className="p-5">
                            <h3 className="text-lg font-semibold">Geselecteerde gebruikers</h3>
                            <div className="mt-4 space-y-2">
                              {addMoneyForm.selectedUserIds.length === 0 ? (
                                <p className="text-sm text-slate-500">Nog niemand geselecteerd.</p>
                              ) : (
                                sortedUsers
                                  .filter((user) => addMoneyForm.selectedUserIds.includes(user.id))
                                  .map((user) => (
                                    <div
                                      key={user.id}
                                      className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-3"
                                    >
                                      <div className="flex items-center gap-3">
                                        <Avatar className="h-9 w-9">
                                          {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
                                          <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                                        </Avatar>
                                        <span className="font-medium">{user.name}</span>
                                      </div>
                                      <span className="text-sm text-slate-500">{euro(user.balance)}</span>
                                    </div>
                                  ))
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </TabsContent>
                  ) : null}
                </CardContent>
              </Tabs>
            </Card>
          </motion.div>
        ) : activeMainTab === "rijschema" ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05 }}
          >
            <Card className="rounded-3xl border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-xl">Rijschema</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Overzicht van uit- en thuiswedstrijden met kilometers en rijders.
                </p>
              </CardHeader>

              <CardContent>
                <div className="overflow-hidden rounded-2xl border bg-white">
                  <div className="space-y-3">
                    {rideSchedule.map((match) => {
                      const isAway = match.location.toLowerCase() === "uit";

                      return (
                        <div
                          key={`${match.date}-${match.team}`}
                          className={`rounded-2xl p-4 shadow-sm ${
                            isAway ? "bg-gray-100" : "bg-white-100"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-slate-500">{match.date}</p>
                            <span className="text-sm font-medium capitalize">
                              {match.location}
                            </span>
                          </div>

                          <h3 className="mt-1 text-base font-semibold">
                            {match.team || "Thuiswedstrijd"}
                          </h3>

                          <div className="mt-2 text-sm text-slate-600">
                            {match.kilometers ? `${match.kilometers} km` : "Geen kilometers"}
                          </div>

                          {match.riders.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {match.riders.map((rider) => (
                                <span
                                  key={rider}
                                  className="rounded-full bg-white px-2 py-1 text-xs font-medium"
                                >
                                  {rider}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05 }}
          >
            <Card className="rounded-3xl border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-xl">Statistieken</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Overzicht van opwaarderingen en trends.
                </p>
              </CardHeader>

              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="rounded-2xl border shadow-none">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-slate-600" />
                        <h3 className="text-lg font-semibold">Algemeen</h3>
                      </div>
                      <p className="text-sm text-slate-600">
                        Aantal opwaarderingen: <span className="font-medium text-slate-900">{statistics.positiveCount}</span>
                      </p>
                      <p className="text-sm text-slate-600">
                        Totaal opgewaardeerd: <span className="font-medium text-slate-900">{euro(statistics.totalTopUps)}</span>
                      </p>
                      <p className="text-sm text-slate-600">
                        Gemiddelde opwaardering: <span className="font-medium text-slate-900">{euro(statistics.averageTopUp)}</span>
                      </p>
                      <p className="text-sm text-slate-600">
                        Grootste opwaardering: <span className="font-medium text-slate-900">{euro(statistics.largestTopUp)}</span>
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl border shadow-none">
                    <CardContent className="space-y-3 p-5">
                      <h3 className="text-lg font-semibold">Kas-kanonnen</h3>
                      {statistics.topSpenders.length === 0 ? (
                        <p className="text-sm text-slate-500">Nog geen opwaarderingen beschikbaar.</p>
                      ) : (
                        <div className="space-y-2">
                          {statistics.topSpenders.map((spender, index) => (
                            <div
                              key={spender.userId}
                              className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"
                            >
                              <span className="text-sm text-slate-700">
                                {index + 1}. {spender.name}
                              </span>
                              <span className="text-sm font-semibold text-slate-900">
                                {euro(spender.total)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl border shadow-none md:col-span-2">
                    <CardContent className="space-y-3 p-5">
                      <h3 className="text-lg font-semibold">Opwaarderingen per maand</h3>
                      {statistics.monthlyTotals.length === 0 ? (
                        <p className="text-sm text-slate-500">Nog geen opwaarderingen beschikbaar.</p>
                      ) : (
                        <div className="space-y-2">
                          {statistics.monthlyTotals.map((item) => (
                            <div
                              key={item.label}
                              className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"
                            >
                              <span className="text-sm text-slate-600">{item.label}</span>
                              <span className="text-sm font-semibold text-slate-900">{euro(item.total)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
      {isPasswordModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => {
            if (isSavingPassword) return;
            setIsPasswordModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Wachtwoord wijzigen</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Vul je huidige wachtwoord in en kies daarna een nieuw wachtwoord.
                </p>
              </div>

              <form onSubmit={changePassword} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Huidig wachtwoord</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPasswordForChange}
                    onChange={(e) => {
                      setCurrentPasswordForChange(e.target.value);
                      setPasswordMessage("");
                    }}
                    placeholder="Je huidige wachtwoord"
                    className="h-11 rounded-2xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nieuw wachtwoord</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setPasswordMessage("");
                    }}
                    placeholder="Minimaal 8 tekens"
                    className="h-11 rounded-2xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-new-password">Herhaal nieuw wachtwoord</Label>
                  <Input
                    id="confirm-new-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setPasswordMessage("");
                    }}
                    placeholder="Herhaal je nieuwe wachtwoord"
                    className="h-11 rounded-2xl"
                  />
                </div>

                {passwordMessage ? (
                  <p className="text-sm text-slate-600">{passwordMessage}</p>
                ) : null}

                <div className="space-y-2 pt-1">
                  <Button
                    type="submit"
                    className="w-full rounded-2xl"
                    disabled={isSavingPassword}
                  >
                    {isSavingPassword ? "Opslaan..." : "Opslaan"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full rounded-2xl"
                    disabled={isSavingPassword}
                    onClick={() => setIsPasswordModalOpen(false)}
                  >
                    Annuleren
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
      {selectedUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            ref={userModalRef}
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="space-y-5 text-center">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">{selectedUser.name}</h2>
              </div>

              <div className="flex justify-center">
                <Avatar className="h-56 w-56 ring-4 ring-slate-100">
                  {selectedUser.avatar ? (
                    <AvatarImage src={selectedUser.avatar} alt={selectedUser.name} />
                  ) : null}
                  <AvatarFallback className="text-2xl">
                    {getInitials(selectedUser.name)}
                  </AvatarFallback>
                </Avatar>
              </div>

              <div className="space-y-3 rounded-2xl bg-slate-50 p-4 text-left">
                <p className="text-base text-slate-700">
                  <span className="font-semibold text-slate-900">Huidig saldo:</span>{" "}
                  {euro(selectedUser.balance)}
                </p>
                <p className="text-base text-slate-700">
                  <span className="font-semibold text-slate-900">Totaal uitgegeven:</span>{" "}
                  {euro(totalPositivePerUser.get(selectedUser.id) ?? 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex max-w-md justify-around py-3">

            <button
              onClick={() => setActiveMainTab("saldo")}
              className="flex flex-col items-center justify-center"
            >
              <Wallet
                className={`transition ${
                  activeMainTab === "saldo"
                    ? "h-6 w-6 text-slate-900"
                    : "h-5 w-5 text-slate-400"
                }`}
              />
              <span
                className={`mt-1 text-xs ${
                  activeMainTab === "saldo"
                    ? "text-slate-900 font-medium"
                    : "text-slate-400"
                }`}
              >
                Saldo
              </span>
            </button>

            <button
              onClick={() => setActiveMainTab("rijschema")}
              className="flex flex-col items-center justify-center"
            >
              <Car
                className={`transition ${
                  activeMainTab === "rijschema"
                    ? "h-6 w-6 text-slate-900"
                    : "h-5 w-5 text-slate-400"
                }`}
              />
              <span
                className={`mt-1 text-xs ${
                  activeMainTab === "rijschema"
                    ? "text-slate-900 font-medium"
                    : "text-slate-400"
                }`}
              >
                Rijschema
              </span>
            </button>

            <button
              onClick={() => setActiveMainTab("statistieken")}
              className="flex flex-col items-center justify-center"
            >
              <BarChart3
                className={`transition ${
                  activeMainTab === "statistieken"
                    ? "h-6 w-6 text-slate-900"
                    : "h-5 w-5 text-slate-400"
                }`}
              />
              <span
                className={`mt-1 text-xs ${
                  activeMainTab === "statistieken"
                    ? "text-slate-900 font-medium"
                    : "text-slate-400"
                }`}
              >
                Statistieken
              </span>
            </button>

          </div>
        </div>
    </div>
  );
}
