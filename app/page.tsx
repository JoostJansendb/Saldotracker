"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

type User = {
  id: number;
  username: string;
  password: string;
  name: string;
  role: "admin" | "user";
  balance: number;
  avatar: string;
};

type AddMoneyFormState = {
  selectedUserIds: number[];
  amount: string;
  message: string;
};

const initialUsers: User[] = [
  { id: 1, username: "admin", password: "admin123", name: "Admin", role: "admin", balance: 0, avatar: "" },
  { id: 2, username: "sewi", password: "team123", name: "Sewi Houben", role: "user", balance: -9.03, avatar: "" },
  { id: 3, username: "bramv", password: "team123", name: "Bram Van Vugt", role: "user", balance: -23.8, avatar: "" },
  { id: 4, username: "max", password: "team123", name: "Max Mallant", role: "user", balance: 3.41, avatar: "" },
  { id: 5, username: "olivier", password: "team123", name: "Olivier Eerden", role: "user", balance: -21.56, avatar: "" },
  { id: 6, username: "hugo", password: "team123", name: "Hugo van Eck", role: "user", balance: -21.76, avatar: "" },
  { id: 7, username: "pepijn", password: "team123", name: "Pepijn Ramaekers", role: "user", balance: 137.68, avatar: "" },
  { id: 8, username: "tommy", password: "team123", name: "Tommy Van der Lee", role: "user", balance: 21.65, avatar: "" },
  { id: 9, username: "sam", password: "team123", name: "Sam Rek", role: "user", balance: -29.79, avatar: "" },
  { id: 10, username: "bramr", password: "team123", name: "Bram Rek", role: "user", balance: -17.79, avatar: "" },
  { id: 11, username: "timon", password: "team123", name: "Timon Ramaekers", role: "user", balance: -104.0, avatar: "" },
  { id: 12, username: "thomas", password: "team123", name: "Thomas Jurgens", role: "user", balance: 133.6, avatar: "" },
  { id: 13, username: "tijn", password: "team123", name: "Tijn Damen", role: "user", balance: -87.97, avatar: "" },
  { id: 14, username: "tim", password: "team123", name: "Tim Rovers", role: "user", balance: -97.66, avatar: "" },
  { id: 15, username: "bas", password: "team123", name: "Bas Rovers", role: "user", balance: -40.24, avatar: "" },
  { id: 16, username: "jonathan", password: "team123", name: "Jonathan Eerden", role: "user", balance: -26.45, avatar: "" },
  { id: 17, username: "joost", password: "welkom123", name: "Joost Jansen", role: "user", balance: -57.49, avatar: "" },
  { id: 18, username: "pieter", password: "team123", name: "Pieter Barneveld", role: "user", balance: 87.38, avatar: "" },
  { id: 19, username: "jelle", password: "team123", name: "Jelle Spijkerman", role: "user", balance: -23.46, avatar: "" },
  { id: 20, username: "dirkjan", password: "team123", name: "Dirk-Jan Udo", role: "user", balance: 0, avatar: "" },
];

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
  const [users, setUsers] = useState<User[]>(initialUsers);
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

  const sortedUsers = useMemo(() => {
    return [...users]
      .filter((user) => user.role !== "admin")
      .sort((a, b) => b.balance - a.balance);
  }, [users]);

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
    setError("");
    setUsername("");
    setPassword("");
  };

  const logout = () => {
    setCurrentUser(null);
  };

  const updateCurrentUserAvatar = (avatar: string) => {
  if (!currentUser) return;

  setUsers((prev) =>
    prev.map((user) =>
      user.id === currentUser.id ? { ...user, avatar } : user
    )
  );

  setCurrentUser((prev) => (prev ? { ...prev, avatar } : prev));
};

const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    const result = reader.result;
    if (typeof result === "string") {
      updateCurrentUserAvatar(result);
      setIsProfileMenuOpen(false);
    }
  };

  reader.readAsDataURL(file);

  e.target.value = "";
};

const removeAvatar = () => {
  if (!currentUser) return;

  setUsers((prev) =>
    prev.map((user) =>
      user.id === currentUser.id ? { ...user, avatar: "" } : user
    )
  );

  setCurrentUser((prev) => (prev ? { ...prev, avatar: "" } : prev));
  setIsProfileMenuOpen(false);
};

  const toggleSelectedUser = (id: number) => {
    setAddMoneyForm((prev) => ({
      ...prev,
      selectedUserIds: prev.selectedUserIds.includes(id)
        ? prev.selectedUserIds.filter((userId) => userId !== id)
        : [...prev.selectedUserIds, id],
      message: "",
    }));
  };

  const addMoneyToSelectedUsers = () => {
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

    setUsers((prev) =>
      prev.map((user) =>
        addMoneyForm.selectedUserIds.includes(user.id)
          ? { ...user, balance: Number((user.balance + parsedAmount).toFixed(2)) }
          : user
      )
    );

    setAddMoneyForm({
      selectedUserIds: [],
      amount: "",
      message: `€ ${parsedAmount.toFixed(2)} toegevoegd aan ${addMoneyForm.selectedUserIds.length} gebruiker(s).`,
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
                  <h1 className="text-xl font-bold sm:text-2xl">Welkom, {currentUser.name}</h1>
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
                              <Avatar className="h-11 w-11">
                                {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
                                <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                              </Avatar>
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
    </div>
  );
}