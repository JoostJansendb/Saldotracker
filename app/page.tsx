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
import { LogOut, ShieldCheck, Wallet, PlusCircle } from "lucide-react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";

type User = {
  id: string;
  username: string;
  password: string;
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

function euro(amount: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .join("")
    .slice(0, 2);
}

export default function SaldoTrackerApp() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [addMoneyForm, setAddMoneyForm] = useState<AddMoneyFormState>({
    selectedUserIds: [],
    amount: "",
    message: "",
  });
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const userModalRef = useRef<HTMLDivElement | null>(null);
  
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
    const fetchUsers = async () => {
      const { data, error } = await supabase.from("users").select("*");

      console.log("SUPABASE users:", data);
      console.log("SUPABASE error:", error);

      if (error) {
        console.error("Fout bij ophalen users:", error);
        return;
      }

      if (data) {
        setUsers(data);
      }
    };

    fetchUsers();
  }, []);

  const sortedUsers = useMemo(() => {
    return [...users]
      .filter((user) => user.role !== "admin")
      .sort((a, b) => b.balance - a.balance);
  }, [users]);

useEffect(() => {
  const storedUser = localStorage.getItem("currentUser");
  if (!storedUser || users.length === 0) return;

  const parsedUser = JSON.parse(storedUser);

  if (parsedUser.role === "admin") {
    setCurrentUser(parsedUser);
    return;
  }

  const freshUser = users.find((user) => user.id === parsedUser.id);

  if (freshUser) {
    setCurrentUser(freshUser);
    localStorage.setItem("currentUser", JSON.stringify(freshUser));
  }
}, [users]);

useEffect(() => {
  if (currentUser) {
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
  }
}, [currentUser]);

  const refreshUsers = async () => {
    const { data } = await supabase.from("users").select("*");
    if (data) setUsers(data);
  };  

const login = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const found = users.find(
      (user) => user.username === username.trim() && user.password === password
    );

    if (!found) {
      setError("Onjuiste gebruikersnaam of wachtwoord.");
      return;
    }

    setCurrentUser(found);
    localStorage.setItem("currentUser", JSON.stringify(found));
    setError("");
    setUsername("");
    setPassword("");
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem("currentUser");
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

    const updates = users
      .filter((user) => addMoneyForm.selectedUserIds.includes(user.id))
      .map((user) => ({
        id: user.id,
        balance: Number((user.balance + parsedAmount).toFixed(2)),
      }));

    for (const update of updates) {
      const { error } = await supabase
        .from("users")
        .update({ balance: update.balance })
        .eq("id", update.id);

      if (error) {
        setAddMoneyForm((prev) => ({
          ...prev,
          message: "Opslaan in database mislukt.",
        }));
        return;
      }
    }

    setUsers((prev) =>
      prev.map((user) => {
        const found = updates.find((u) => u.id === user.id);
        return found ? { ...user, balance: found.balance } : user;
      })
    );

    setAddMoneyForm({
      selectedUserIds: [],
      amount: "",
      message: `€ ${parsedAmount.toFixed(2)} toegevoegd aan ${updates.length} gebruiker(s).`,
    });
  };

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
                  <p className="font-medium text-slate-800">Versie 1.0.0</p>
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
    <div className="min-h-screen bg-slate-50 p-3 sm:p-4 md:p-8">
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
                    <span className="text-sm text-slate-500">Saldo per teamlid</span>
                  </div>
                </div>
              </div>

              <Button variant="outline" onClick={logout} className="rounded-2xl">
                <LogOut className="mr-2 h-4 w-4" />
                Uitloggen
              </Button>
            </CardContent>
          </Card>
        </motion.div>

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
                      Gesorteerd van hoog naar laag.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 sm:items-end">
                    {currentUser.role === "admin" ? (
                      <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">
                        <ShieldCheck className="mr-1 h-4 w-4" />
                        Admin kan saldo&apos;s aanpassen
                      </Badge>
                    ) : null}

                    <TabsList className={`grid rounded-2xl ${currentUser.role === "admin" ? "grid-cols-2" : "grid-cols-1"} w-full sm:w-[280px]`}>
                      <TabsTrigger value="overzicht">Overzicht</TabsTrigger>
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
      </div>
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
                  €0,00
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex justify-center pt-4 pb-6">
        <Button onClick={refreshUsers} className="rounded-2xl">
          <RefreshCw className="mr-2 h-4 w-4" />
          Verversen
        </Button>
      </div>
    </div>
  );
}