import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateEmail, updatePassword, deleteUser } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { UserProfile } from '../types';
import { 
  Users as UsersIcon, 
  UserPlus, 
  X, 
  Shield, 
  Ban, 
  CheckCircle2, 
  AlertCircle, 
  Mail, 
  Trash2,
  Lock,
  Sliders,
  Check,
  Eye,
  EyeOff,
  Copy,
  Edit2
} from 'lucide-react';
import { cn } from '../lib/utils';

const MENU_OPTIONS = [
  { id: 'dashboard', name: 'Tableau de bord', description: 'Statistiques et graphiques généraux' },
  { id: 'pos', name: 'Vente (POS / Caisse)', description: 'Caisse, vente directe et paniers' },
  { id: 'products', name: 'Gestion des Produits', description: 'Inventaire, stocks et alertes' },
  { id: 'clients', name: 'Gestion des Clients', description: 'Liste des clients et suivi des dettes' },
  { id: 'sales', name: 'Historique des Ventes', description: 'Suivi et recherche des ventes' },
  { id: 'invoices', name: 'Facturation', description: 'Édition et gestion des factures' },
  { id: 'notes', name: 'Mémos & Notes', description: 'Ajouter et planifier des mémos' },
  { id: 'settings', name: 'Paramètres du Magasin', description: 'Configurations de base' },
  { id: 'users', name: 'Gestion des Utilisateurs', description: 'Accès restreint pour gérer l\'équipe' },
];

export default function Users() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [errorOnCreate, setErrorOnCreate] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Password visibility state for each user in the table: key is user uid
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  // Copied indicator state to show temporary checkmark
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Form states - Create
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [roleInput, setRoleInput] = useState<'admin' | 'user'>('user');
  const [selectedMenus, setSelectedMenus] = useState<string[]>(['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices']);

  // Unified editing state
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
  const [editStatus, setEditStatus] = useState<'active' | 'banned'>('active');
  const [editSelectedMenus, setEditSelectedMenus] = useState<string[]>([]);
  const [errorOnEdit, setErrorOnEdit] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const uList = snapshot.docs.map(doc => ({ ...doc.data() } as UserProfile));
      setUsers(uList);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleRoleChangeOnCreate = (role: 'admin' | 'user') => {
    setRoleInput(role);
    if (role === 'admin') {
      setSelectedMenus(MENU_OPTIONS.map(m => m.id));
    } else {
      setSelectedMenus(['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices']);
    }
  };

  const handleToggleMenuSelection = (menuId: string) => {
    setSelectedMenus(prev => 
      prev.includes(menuId) ? prev.filter(id => id !== menuId) : [...prev, menuId]
    );
  };

  const handleToggleEditMenuSelection = (menuId: string) => {
    setEditSelectedMenus(prev => 
      prev.includes(menuId) ? prev.filter(id => id !== menuId) : [...prev, menuId]
    );
  };

  const copyToClipboard = (text: string, fieldKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorOnCreate(null);
    setActionLoading('creating');

    if (passwordInput.length < 6) {
      setErrorOnCreate('Le mot de passe doit contenir au moins 6 caractères.');
      setActionLoading(null);
      return;
    }

    if (selectedMenus.length === 0) {
      setErrorOnCreate('Veuillez sélectionner au moins un privilège d\'accès.');
      setActionLoading(null);
      return;
    }

    const tempAppName = 'TempUserCreation_' + Date.now();
    let tempApp: any = null;
    try {
      tempApp = initializeApp(firebaseConfig, tempAppName);
      const tempAuth = getAuth(tempApp);

      // 1. Create the user in Firebase Auth under the user's project
      const userCred = await createUserWithEmailAndPassword(tempAuth, emailInput, passwordInput);
      const targetUid = userCred.user.uid;

      // 2. Create the document in Firestore using the logged-in admin's handle
      await setDoc(doc(db, "users", targetUid), {
        uid: targetUid,
        email: emailInput,
        password: passwordInput,
        role: roleInput,
        status: 'active',
        allowedMenus: selectedMenus
      });

      // 3. Log out of transient app
      await tempAuth.signOut();

      setSuccess('Utilisateur créé avec succès ! Identifiants enregistrés dans le système.');
      setIsModalOpen(false);
      setEmailInput('');
      setPasswordInput('');
      setRoleInput('user');
      setSelectedMenus(['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices']);

      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      console.error(err);
      setErrorOnCreate(err.message || 'Une erreur est survenue.');
    } finally {
      if (tempApp) {
        try {
          await tempApp.delete();
        } catch (delErr) {
          console.error(delErr);
        }
      }
      setActionLoading(null);
    }
  };

  const handleOpenEdit = (user: UserProfile) => {
    setEditingUser(user);
    setEditEmail(user.email || '');
    setEditPassword(user.password || '');
    setEditRole(user.role || 'user');
    setEditStatus(user.status || 'active');
    setEditSelectedMenus(user.allowedMenus || (
      user.role === 'admin' 
        ? MENU_OPTIONS.map(m => m.id)
        : ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes']
    ));
    setErrorOnEdit(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setErrorOnEdit(null);
    setActionLoading('editing');

    if (editPassword.length < 6) {
      setErrorOnEdit('Le mot de passe doit contenir au moins 6 caractères.');
      setActionLoading(null);
      return;
    }

    if (editSelectedMenus.length === 0) {
      setErrorOnEdit('Veuillez sélectionner au moins un droit d\'accès.');
      setActionLoading(null);
      return;
    }

    const tempAppName = 'TempUserUpdate_' + Date.now();
    let tempApp: any = null;
    try {
      const emailChanged = editEmail !== editingUser.email;
      const passwordChanged = editPassword !== editingUser.password;

      // If email or password changed, update Firebase Auth using secondary credentials login
      if (emailChanged || passwordChanged) {
        tempApp = initializeApp(firebaseConfig, tempAppName);
        const tempAuth = getAuth(tempApp);

        const oldEmail = editingUser.email || '';
        const oldPassword = editingUser.password || '';
        const userCred = await signInWithEmailAndPassword(tempAuth, oldEmail, oldPassword);

        if (emailChanged) {
          await updateEmail(userCred.user, editEmail);
        }
        if (passwordChanged) {
          await updatePassword(userCred.user, editPassword);
        }

        await tempAuth.signOut();
      }

      // Update in Firestore using the logged-in admin's handles
      const userRef = doc(db, "users", editingUser.uid);
      await updateDoc(userRef, {
        email: editEmail,
        password: editPassword,
        role: editRole,
        status: editStatus,
        allowedMenus: editSelectedMenus
      });

      setSuccess(`Utilisateur ${editEmail} mis à jour avec succès.`);
      setEditingUser(null);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      console.error(err);
      setErrorOnEdit(err.message || 'Une erreur est survenue lors de la modification.');
    } finally {
      if (tempApp) {
        try {
          await tempApp.delete();
        } catch (delErr) {
          console.error(delErr);
        }
      }
      setActionLoading(null);
    }
  };

  const handleToggleStatus = async (user: UserProfile) => {
    const newStatus = user.status === 'banned' ? 'active' : 'banned';
    if (!confirm(`La caisse sera bloquée pour cet utilisateur. Êtes-vous sûr de vouloir ${newStatus === 'banned' ? 'bannir' : 'activer'} ${user.email} ?`)) {
      return;
    }

    try {
      // Directly check and update in Firestore using active session
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        status: newStatus
      });

      setSuccess(`L'utilisateur ${user.email} est désormais ${newStatus === 'banned' ? 'banni' : 'actif'}.`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      alert(err.message || "Erreur de mise à jour");
    }
  };

  const handleDeleteProfileAndAuth = async (user: UserProfile) => {
    if (!confirm(`ATTENTION: Êtes-vous sûr de vouloir supprimer définitivement ${user.email} ? Cette action supprimera sa fiche de caisse ainsi que ses identifiants de connexion Firebase.`)) {
      return;
    }

    const tempAppName = 'TempUserDelete_' + Date.now();
    let tempApp: any = null;
    try {
      if (user.email && user.password) {
        tempApp = initializeApp(firebaseConfig, tempAppName);
        const tempAuth = getAuth(tempApp);
        try {
          const userCred = await signInWithEmailAndPassword(tempAuth, user.email, user.password);
          await deleteUser(userCred.user);
        } catch (authErr) {
          console.warn("Could not delete from Firebase Auth (maybe already gone/changed):", authErr);
        }
      }

      // Delete from Firestore
      await deleteDoc(doc(db, "users", user.uid));

      setSuccess(`Compte et identifiants de ${user.email} supprimés définitivement.`);
      setTimeout(() => setSuccess(null), 3500);
    } catch (err: any) {
      alert(err.message || "Erreur lors de la suppression.");
    } finally {
      if (tempApp) {
        try {
          await tempApp.delete();
        } catch (delErr) {
          console.error(delErr);
        }
      }
    }
  };

  const togglePasswordVisibility = (uid: string) => {
    setVisiblePasswords(prev => ({
      ...prev,
      [uid]: !prev[uid]
    }));
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <UsersIcon className="w-7 h-7 text-indigo-600 fill-indigo-100/40" />
            Gestion des Utilisateurs
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Visualisez les identifiants, gérez les accès détaillés et modifiez en temps réel les caissiers.
          </p>
        </div>

        <button
          onClick={() => {
            setErrorOnCreate(null);
            setIsModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-xs font-extrabold uppercase tracking-wider rounded-xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-600/10 active:scale-95 shrink-0 self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          Créer un utilisateur
        </button>
      </div>

      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-800 text-xs font-bold leading-relaxed flex items-center gap-2.5 animate-in fade-in duration-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 animate-bounce" />
          {success}
        </div>
      )}

      {/* Main Table with User Details/Credentials */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        {loading ? (
          <div className="p-16 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : users.length === 0 ? (
          <div className="p-16 text-center text-slate-400 space-y-2">
            <UsersIcon className="w-12 h-12 mx-auto opacity-30 text-indigo-500" />
            <p className="text-sm font-bold">Aucun utilisateur trouvé</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Utilisateur & ID</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Coordonnées de connexion</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Rôle</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Menus visibles</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Statut</th>
                  <th className="py-4 px-6 text-[10px] font-extrabold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((profile) => {
                  const allowed = profile.allowedMenus || (
                    profile.role === 'admin'
                      ? MENU_OPTIONS.map(m => m.id)
                      : ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes']
                  );
                  const isPassVisible = !!visiblePasswords[profile.uid];
                  const passwordToDisplay = profile.password || 'Non spécifié';

                  return (
                    <tr key={profile.uid} className="group hover:bg-slate-50/20 transition-colors">
                      {/* Left Block: Avatar and Email/UID info */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center font-black text-xs border border-indigo-100/50",
                            profile.role === 'admin' ? "text-purple-600 bg-purple-50/70 border-purple-100" : "text-indigo-600"
                          )}>
                            {profile.email ? profile.email[0].toUpperCase() : '?'}
                          </div>
                          <div>
                            <div className="font-bold text-xs text-slate-800 flex items-center gap-1.5 leading-none">
                              {profile.email}
                            </div>
                            <span className="text-[9px] text-slate-400 font-mono mt-1 block">ID: {profile.uid.substring(0, 10)}...</span>
                          </div>
                        </div>
                      </td>

                      {/* Credentials Display Column with copy functions */}
                      <td className="py-4 px-6">
                        <div className="space-y-1 text-xs">
                          {/* Email Copy Line */}
                          <div className="flex items-center gap-2 group/btn">
                            <span className="text-[10px] uppercase font-black text-slate-400 w-10">Email:</span>
                            <span className="font-semibold text-slate-700 text-xs">{profile.email}</span>
                            <button
                              onClick={() => copyToClipboard(profile.email, `${profile.uid}-email`)}
                              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all opacity-0 group-hover/btn:opacity-100"
                              title="Copier l'adresse email"
                            >
                              {copiedField === `${profile.uid}-email` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          {/* Password line with decrypt hide/show */}
                          <div className="flex items-center gap-2 group/btn">
                            <span className="text-[10px] uppercase font-black text-slate-400 w-10">Passe:</span>
                            <span className="font-mono bg-slate-50 text-slate-700 px-1.5 py-0.5 rounded-md border border-slate-100 text-xs font-semibold">
                              {isPassVisible ? passwordToDisplay : '••••••••'}
                            </span>
                            
                            <div className="flex items-center gap-0.5 opacity-100 sm:opacity-50 sm:group-hover/btn:opacity-100 transition-all">
                              <button
                                onClick={() => togglePasswordVisibility(profile.uid)}
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-md"
                                title={isPassVisible ? 'Masquer' : 'Afficher le mot de passe'}
                              >
                                {isPassVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => copyToClipboard(passwordToDisplay, `${profile.uid}-pass`)}
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-md"
                                title="Copier le mot de passe"
                              >
                                {copiedField === `${profile.uid}-pass` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Rôle Badge */}
                      <td className="py-4 px-6">
                        <span className={cn(
                          "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1.5",
                          profile.role === 'admin' 
                            ? "bg-purple-50 text-purple-700 border border-purple-100" 
                            : "bg-blue-50 text-blue-700 border border-blue-100"
                        )}>
                          <Shield className="w-3 h-3" />
                          {profile.role === 'admin' ? 'Administrateur' : 'Caissier'}
                        </span>
                      </td>

                      {/* Allowed Menus List */}
                      <td className="py-4 px-6 max-w-xs">
                        <div className="flex flex-wrap gap-1">
                          {MENU_OPTIONS.map((menu) => {
                            const isAllowed = allowed.includes(menu.id);
                            return (
                              <span 
                                key={menu.id} 
                                className={cn(
                                  "text-[9px] px-1.5 py-0.5 rounded-md font-bold transition-all border",
                                  isAllowed 
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                                    : "bg-slate-100 text-slate-400 border-transparent opacity-40 line-through"
                                )}
                                title={menu.description}
                              >
                                {menu.name.split(' ')[0]}
                              </span>
                            );
                          })}
                        </div>
                      </td>

                      {/* Statut Badge */}
                      <td className="py-4 px-6">
                        <span className={cn(
                          "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1.5",
                          profile.status === 'banned' 
                            ? "bg-rose-50 text-rose-700 border border-rose-100" 
                            : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                        )}>
                          <span className={cn("w-1.5 h-1.5 rounded-full", profile.status === 'banned' ? "bg-rose-500" : "bg-emerald-500")} />
                          {profile.status === 'banned' ? 'Banni' : 'Actif'}
                        </span>
                      </td>

                      {/* Combined Actions: Edit, Toggle Status, Delete */}
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenEdit(profile)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-105 hover:bg-indigo-50 hover:text-indigo-650 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border border-slate-100 hover:border-indigo-150 transition-colors"
                            title="Modifier ce profil"
                          >
                            <Edit2 className="w-3 h-3" />
                            Modifier
                          </button>

                          <button
                            onClick={() => handleToggleStatus(profile)}
                            className={cn(
                              "inline-flex items-center gap-1 px-2 py-1.5 rounded-xl text-[10px] font-extrabold uppercase tracking-wider border transition-colors",
                              profile.status === 'banned'
                                ? "bg-emerald-50/50 text-emerald-600 border-emerald-100 hover:bg-emerald-50"
                                : "bg-slate-100 text-slate-600 border-transparent hover:bg-rose-50 hover:text-rose-600 hover:border-rose-105"
                            )}
                            title={profile.status === 'banned' ? 'Débloquer cet utilisateur' : 'Bloquer cet utilisateur'}
                          >
                            <Ban className="w-3.5 h-3.5" />
                            {profile.status === 'banned' ? 'Activer' : 'Bloquer'}
                          </button>

                          <button
                            onClick={() => handleDeleteProfileAndAuth(profile)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all border border-transparent hover:border-rose-100"
                            title="Supprimer définitivement l'utilisateur"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Creation Modal (Add User) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg my-8 overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-55/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <UserPlus className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Ajouter un Utilisateur</h2>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-55 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {errorOnCreate && (
                <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-bold leading-normal flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  {errorOnCreate}
                </div>
              )}

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Adresse Email de connexion</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="caissier1@smartech.tn"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Mot de passe (Min 6 caractères)</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="Saisissez un mot de passe facile"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                  />
                </div>
              </div>

              {/* Base Role */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Rôle de Base</label>
                <select
                  value={roleInput}
                  onChange={(e) => handleRoleChangeOnCreate(e.target.value as 'admin' | 'user')}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                >
                  <option value="user">Caissier / Vendeur Standard</option>
                  <option value="admin">Administrateur (Accès Intégral)</option>
                </select>
              </div>

              {/* Menus Accesses Checkboxes */}
              <div className="border-t border-slate-100 pt-4 space-y-2">
                <div>
                  <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block">Menus latéraux autorisés</label>
                  <span className="text-[9px] text-slate-400 font-medium">Configurez les sections auxquelles ce caissier aura accès :</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MENU_OPTIONS.filter((menu) => {
                    if (roleInput === 'user' && (menu.id === 'users' || menu.id === 'settings')) return false;
                    return true;
                  }).map((menu) => {
                    const isChecked = selectedMenus.includes(menu.id);
                    return (
                      <button
                        type="button"
                        key={menu.id}
                        onClick={() => handleToggleMenuSelection(menu.id)}
                        className={cn(
                          "p-3 rounded-2xl text-left border transition-all flex items-start gap-2.5 hover:bg-slate-50",
                          isChecked 
                            ? "bg-indigo-50/40 border-indigo-200 text-indigo-900" 
                            : "bg-white border-slate-100 text-slate-600"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-all",
                          isChecked 
                            ? "bg-indigo-600 border-indigo-600 text-white" 
                            : "bg-white border-slate-350"
                        )}>
                          {isChecked && <Check className="w-3 h-3 stroke-[3.5]" />}
                        </div>
                        <div>
                          <div className="text-xs font-extrabold leading-tight">{menu.name}</div>
                          <p className="text-[9px] text-slate-400 leading-normal mt-0.5">{menu.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Submit / Action Buttons */}
              <div className="pt-4 flex gap-3 border-t border-slate-100 font-sans">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={actionLoading !== null}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-indigo-600/15"
                >
                  {actionLoading === 'creating' ? 'Création en cours...' : 'Créer le compte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unified Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg my-8 overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Modifier l'Utilisateur</h2>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">{editingUser.email}</p>
                </div>
              </div>
              <button 
                onClick={() => setEditingUser(null)} 
                className="p-2 text-slate-400 hover:text-slate-650 hover:bg-slate-50 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {errorOnEdit && (
                <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-bold leading-normal flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  {errorOnEdit}
                </div>
              )}

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Email de connexion</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Aperçu ou Nouveau Mot de Passe (Min 6 caractères)</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                  />
                </div>
              </div>

              {/* Role */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Rôle</label>
                <select
                  value={editRole}
                  onChange={(e) => {
                    const newRole = e.target.value as 'admin' | 'user';
                    setEditRole(newRole);
                    if (newRole === 'user') {
                      setEditSelectedMenus((prev) => prev.filter((mid) => mid !== 'users' && mid !== 'settings'));
                    } else if (newRole === 'admin') {
                      setEditSelectedMenus(MENU_OPTIONS.map((m) => m.id));
                    }
                  }}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                >
                  <option value="user">Caissier / Vendeur Standard</option>
                  <option value="admin">Administrateur (Accès Intégral)</option>
                </select>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Statut du compte</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as 'active' | 'banned')}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow"
                >
                  <option value="active">Actif (Accès autorisé)</option>
                  <option value="banned">Bloqué / Banni (Accès refusé)</option>
                </select>
              </div>

              {/* Menu privileges checkboxes */}
              <div className="border-t border-slate-100 pt-4 space-y-2">
                <div>
                  <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block font-bold">Modifier les Menus Autorisés</label>
                  <span className="text-[9px] text-slate-400 font-medium">Cochez les sections visibles dans la barre latérale pour cet utilisateur :</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MENU_OPTIONS.filter((menu) => {
                    if (editRole === 'user' && (menu.id === 'users' || menu.id === 'settings')) return false;
                    return true;
                  }).map((menu) => {
                    const isChecked = editSelectedMenus.includes(menu.id);
                    return (
                      <button
                        type="button"
                        key={menu.id}
                        onClick={() => handleToggleEditMenuSelection(menu.id)}
                        className={cn(
                          "p-3 rounded-2xl text-left border transition-all flex items-start gap-2.5 hover:bg-slate-50",
                          isChecked 
                            ? "bg-indigo-50/40 border-indigo-200 text-indigo-900" 
                            : "bg-white border-slate-100 text-slate-600"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-all",
                          isChecked 
                            ? "bg-indigo-600 border-indigo-600 text-white" 
                            : "bg-white border-slate-350"
                        )}>
                          {isChecked && <Check className="w-3 h-3 stroke-[3.5]" />}
                        </div>
                        <div>
                          <div className="text-xs font-extrabold leading-tight">{menu.name}</div>
                          <p className="text-[9px] text-slate-400 leading-normal mt-0.5">{menu.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Save Buttons */}
              <div className="pt-4 flex gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={actionLoading !== null}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-indigo-600/15"
                >
                  {actionLoading === 'editing' ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
