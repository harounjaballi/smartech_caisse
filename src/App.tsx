import React, { useEffect, useState, Component } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { 
  LayoutDashboard, 
  Package, 
  Users, 
  ShoppingCart, 
  History, 
  LogOut, 
  Menu, 
  X,
  AlertTriangle,
  FileText,
  RefreshCcw,
  Settings as SettingsIcon,
  UserCheck,
  StickyNote,
  Bell,
  Calendar,
  CheckCircle
} from 'lucide-react';
import { cn } from './lib/utils';
import { UserProfile, Note } from './types';

// Components
import Dashboard from './components/Dashboard';
import Products from './components/Products';
import Clients from './components/Clients';
import POS from './components/POS';
import Sales from './components/Sales';
import Invoices from './components/Invoices';
import Settings from './components/Settings';
import Login from './components/Login';
import UsersManager from './components/Users';
import Notes from './components/Notes';

// Error Handling
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayError = "Une erreur inattendue est survenue.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) displayError = parsed.error;
      } catch (e) {
        displayError = this.state.error?.message || displayError;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black text-gray-900 mb-2">Oups !</h1>
            <p className="text-gray-600 mb-8">{displayError}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/10"
            >
              <RefreshCcw className="w-5 h-5" />
              Actualiser la page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function hasMenuAccess(userProfile: UserProfile | null, menuId: string): boolean {
  if (!userProfile) return false;
  
  // Custom permissions. Default standard and admin arrays if not present.
  const allowed = userProfile.allowedMenus || (
    userProfile.role === 'admin' 
      ? ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes', 'users', 'settings']
      : ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes']
  );
  
  // Admin-only failsafe for user manager menu
  if (menuId === 'users' && userProfile.role !== 'admin') return false;
  
  return allowed.includes(menuId);
}

function Sidebar({ isOpen, setIsOpen, userProfile, todayNotesCount }: { isOpen: boolean; setIsOpen: (v: boolean) => void; userProfile: UserProfile | null; todayNotesCount: number }) {
  const location = useLocation();
  
  const allNavItems = [
    { id: 'dashboard', name: 'Tableau de bord', path: '/', icon: LayoutDashboard },
    { id: 'pos', name: 'Vente (POS)', path: '/pos', icon: ShoppingCart },
    { id: 'products', name: 'Produits', path: '/products', icon: Package },
    { id: 'clients', name: 'Clients', path: '/clients', icon: Users },
    { id: 'sales', name: 'Historique', path: '/sales', icon: History },
    { id: 'invoices', name: 'Factures', path: '/invoices', icon: FileText },
    { id: 'notes', name: 'Mémos & Notes', path: '/notes', icon: StickyNote },
    { id: 'settings', name: 'Paramètres', path: '/settings', icon: SettingsIcon },
    { id: 'users', name: 'Utilisateurs', path: '/users', icon: UserCheck, adminOnly: true },
  ];

  const navItems = allNavItems.filter((item) => {
    if (item.adminOnly && userProfile?.role !== 'admin') return false;
    return hasMenuAccess(userProfile, item.id);
  });

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}
      
      <aside className={cn(
        "fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-100 z-50 transition-transform duration-300 lg:translate-x-0 shadow-sm shadow-slate-100/40",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="h-full flex flex-col">
          <div className="p-6 flex items-center justify-between border-b border-slate-50">
            <h1 className="text-2xl font-black flex flex-col leading-none font-display">
              <span className="flex items-center gap-2 tracking-tight">
                <ShoppingCart className="w-7 h-7 text-indigo-600 fill-indigo-100/40 animate-pulse" />
                <span className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 bg-clip-text text-transparent">
                  SmarTech
                </span>
              </span>
              <span className="text-[9px] font-black uppercase tracking-widest bg-gradient-to-r from-indigo-500 to-cyan-500 bg-clip-text text-transparent mt-1.5 font-sans">
                Solution de Caisse
              </span>
            </h1>
            <button onClick={() => setIsOpen(false)} className="lg:hidden p-1.5 hover:bg-slate-50 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-xs uppercase tracking-wider font-extrabold transition-all duration-300 relative group",
                    isActive 
                      ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15" 
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <Icon className={cn("w-4 h-4 transition-transform group-hover:scale-110 duration-300", isActive ? "text-white" : "text-slate-400")} />
                  <span className="flex-1">{item.name}</span>
                  {item.id === 'notes' && todayNotesCount > 0 && (
                    <span className={cn(
                      "px-2 py-0.5 text-[10px] rounded-full font-black min-w-[18px] text-center",
                      isActive ? "bg-white text-indigo-600 animate-pulse" : "bg-rose-500 text-white"
                    )}>
                      {todayNotesCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="p-4 border-t border-slate-100 bg-slate-50/50">
            <button
              onClick={() => signOut(auth)}
              className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-xs uppercase tracking-wider font-extrabold text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
            >
              <LogOut className="w-4 h-4 text-red-500" />
              Déconnexion
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [todayNotes, setTodayNotes] = useState<Note[]>([]);
  const [showNotesPopover, setShowNotesPopover] = useState(false);

  // Dynamic formatted human date in French
  const getFormattedDate = () => {
    const raw = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  // Listen to today's notes
  useEffect(() => {
    if (!user) {
      setTodayNotes([]);
      return;
    }
    const todayStr = new Date().toISOString().split('T')[0];
    const q = query(collection(db, 'notes'), orderBy('date', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsedNotes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Note));
      // Only keep notes that match today's date
      const todays = parsedNotes.filter(n => n.date === todayStr);
      setTodayNotes(todays);
    }, (error) => {
      console.warn("Notes snapshot list error or missing collection: ", error);
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Ensure user profile exists
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          const defaultAllowed = user.email === 'harounjaballi@gmail.com'
            ? ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes', 'users', 'settings']
            : ['dashboard', 'pos', 'products', 'clients', 'sales', 'invoices', 'notes'];
          const profileData: UserProfile = {
            uid: user.uid,
            email: user.email || '',
            role: user.email === 'harounjaballi@gmail.com' ? 'admin' : 'user',
            status: 'active',
            allowedMenus: defaultAllowed
          };
          await setDoc(userRef, profileData);
        }

        // Set up real-time listener for current user document
        unsubscribeProfile = onSnapshot(userRef, (snap) => {
          if (snap.exists()) {
            const profileData = snap.data() as UserProfile;
            if (profileData.status === 'banned') {
              if (unsubscribeProfile) {
                unsubscribeProfile();
                unsubscribeProfile = null;
              }
              signOut(auth).then(() => {
                alert('Votre compte a été banni. Veuillez contacter l\'administrateur.');
              });
              return;
            }
            setUserProfile(profileData);
          }
        });
      } else {
        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = null;
        }
        setUserProfile(null);
      }
      setUser(user);
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <ErrorBoundary>
      <Router>
        <div className="min-h-screen bg-slate-50/50 flex" onClick={() => {
          if (showNotesPopover) setShowNotesPopover(false);
        }}>
          <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} userProfile={userProfile} todayNotesCount={todayNotes.length} />
          
          <main className="flex-1 lg:pl-64 min-h-screen flex flex-col">
            <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30 shadow-xs">
              <button 
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
              
              {/* Interactive Date & Notes Notification Badge widget */}
              <div className="flex items-center gap-2 lg:gap-3.5 ml-2 sm:ml-4 relative" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-700 shadow-3xs font-mono">
                  <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{getFormattedDate()}</span>
                </div>

                <div className="relative">
                  <button
                    onClick={() => setShowNotesPopover(!showNotesPopover)}
                    className={cn(
                      "p-2 rounded-xl border transition-all duration-300 relative cursor-pointer",
                      todayNotes.length > 0
                        ? "bg-amber-50 hover:bg-amber-100 border-amber-200/60 text-amber-600 shadow-sm"
                        : "bg-slate-50 hover:bg-slate-100 border-slate-100 text-slate-400"
                    )}
                    title={todayNotes.length > 0 ? `${todayNotes.length} mémo(s) pour aujourd'hui !` : "Aucun mémo aujourd'hui"}
                  >
                    <Bell className={cn("w-4 h-4", todayNotes.length > 0 && "animate-bounce duration-1000")} />
                    {todayNotes.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-[9px] text-white font-black rounded-full flex items-center justify-center border-2 border-white shadow-xs">
                        {todayNotes.length}
                      </span>
                    )}
                  </button>

                  {/* Dropdown Popover with real-time notes */}
                  {showNotesPopover && (
                    <div className="absolute left-0 mt-2.5 w-76 sm:w-80 bg-white border border-slate-100 rounded-2xl shadow-xl z-50 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="flex items-center justify-between border-b border-slate-50 pb-2.5 mb-2.5">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <StickyNote className="w-4 h-4 text-indigo-500 animate-pulse" />
                          Mémos d'aujourd'hui
                        </span>
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md text-slate-500 bg-slate-50 border border-slate-100">
                          {todayNotes.length} actif{todayNotes.length > 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {todayNotes.length === 0 ? (
                          <div className="text-center py-4 text-slate-400">
                            <CheckCircle className="w-7 h-7 text-emerald-400 mx-auto mb-1.5" />
                            <p className="text-[10px] font-[900] uppercase tracking-wide text-slate-500">Tout est en ordre</p>
                            <p className="text-[9px] font-semibold text-slate-400 mt-0.5">Aucun mémo pour aujourd’hui.</p>
                          </div>
                        ) : (
                          todayNotes.map((note) => (
                            <div key={note.id} className="p-2.5 rounded-xl bg-slate-50/50 border border-slate-100/80 hover:border-indigo-100 hover:bg-indigo-50/10 transition-colors">
                              <p className="text-xs font-extrabold text-slate-800 tracking-tight">{note.title}</p>
                              <p className="text-[10px] text-slate-500 font-medium mt-1 line-clamp-3 leading-relaxed">{note.content}</p>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="border-t border-slate-50 mt-3 pt-2.5 text-center">
                        <Link
                          to="/notes"
                          onClick={() => setShowNotesPopover(false)}
                          className="inline-flex items-center justify-center w-full py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 text-white text-[10px] uppercase tracking-wider font-extrabold rounded-xl transition-all shadow-md shadow-indigo-600/10"
                        >
                          Gérer tous les mémos
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1"></div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 font-semibold hidden sm:block bg-slate-100 px-3 py-1 rounded-full">{user.email}</span>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center text-white font-black font-display text-sm shadow-md shadow-indigo-600/15">
                  {user.email?.[0].toUpperCase()}
                </div>
              </div>
            </header>
 
            <div className="p-4 lg:p-8 flex-1">
              <Routes>
                <Route path="/" element={hasMenuAccess(userProfile, 'dashboard') ? <Dashboard /> : <Navigate to={hasMenuAccess(userProfile, 'pos') ? '/pos' : (hasMenuAccess(userProfile, 'products') ? '/products' : (hasMenuAccess(userProfile, 'clients') ? '/clients' : (hasMenuAccess(userProfile, 'sales') ? '/sales' : (hasMenuAccess(userProfile, 'invoices') ? '/invoices' : '/settings'))))} replace />} />
                <Route path="/products" element={hasMenuAccess(userProfile, 'products') ? <Products /> : <Navigate to="/" replace />} />
                <Route path="/clients" element={hasMenuAccess(userProfile, 'clients') ? <Clients /> : <Navigate to="/" replace />} />
                <Route path="/pos" element={hasMenuAccess(userProfile, 'pos') ? <POS /> : <Navigate to="/" replace />} />
                <Route path="/sales" element={hasMenuAccess(userProfile, 'sales') ? <Sales /> : <Navigate to="/" replace />} />
                <Route path="/invoices" element={hasMenuAccess(userProfile, 'invoices') ? <Invoices /> : <Navigate to="/" replace />} />
                <Route path="/notes" element={hasMenuAccess(userProfile, 'notes') ? <Notes /> : <Navigate to="/" replace />} />
                <Route path="/users" element={userProfile?.role === 'admin' && hasMenuAccess(userProfile, 'users') ? <UsersManager /> : <Navigate to="/" replace />} />
                <Route path="/settings" element={hasMenuAccess(userProfile, 'settings') ? <Settings /> : <Navigate to="/" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </Router>
    </ErrorBoundary>
  );
}
