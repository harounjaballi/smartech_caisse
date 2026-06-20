import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, Timestamp, orderBy, limit, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Sale, Product, StoreSettings } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { TrendingUp, DollarSign, Package, AlertTriangle, ArrowUpRight, ArrowDownRight, ShoppingCart, Users } from 'lucide-react';
import { startOfDay, endOfDay, isSameDay } from 'date-fns';
import { cn } from '../lib/utils';

export default function Dashboard() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch all sales for today (and some history for stats)
    const qSales = query(collection(db, 'sales'), orderBy('date', 'desc'), limit(100));
    const unsubscribeSales = onSnapshot(qSales, (snapshot) => {
      setSales(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'sales'));

    const unsubscribeProds = onSnapshot(collection(db, 'products'), (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'products'));

    const unsubscribeStore = onSnapshot(doc(db, 'settings', 'store'), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'settings/store'));

    return () => {
      unsubscribeSales();
      unsubscribeProds();
      unsubscribeStore();
    };
  }, []);

  const currency = storeSettings?.currency || 'DT';

  const stats = useMemo(() => {
    const today = new Date();
    const todaySales = sales.filter(s => s.date?.toDate && isSameDay(s.date.toDate(), today));
    
    const dailyRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);
    const dailyPaid = todaySales.reduce((sum, s) => sum + s.paid, 0);
    const dailyDebt = todaySales.reduce((sum, s) => sum + s.debt, 0);
    
    const lowStockProducts = products.filter(p => p.stock <= (p.lowStockAlert || 5));
    
    // Most sold products
    const productCounts: Record<string, { name: string, count: number, total: number }> = {};
    sales.forEach(sale => {
      sale.items.forEach(item => {
        if (!productCounts[item.productId]) {
          productCounts[item.productId] = { name: item.name, count: 0, total: 0 };
        }
        productCounts[item.productId].count += item.quantity;
        productCounts[item.productId].total += item.total;
      });
    });

    const topProducts = Object.values(productCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      dailyRevenue,
      dailyPaid,
      dailyDebt,
      lowStockCount: lowStockProducts.length,
      topProducts,
      totalProducts: products.length,
      todaySalesCount: todaySales.length
    };
  }, [sales, products]);

  if (loading) return (
    <div className="h-full flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-700"></div>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Tableau de Bord</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Aperçu quotidien des performances de vente</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-xs premium-shadow space-y-4">
          <div className="flex items-center justify-between">
            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-xs">
              <TrendingUp className="w-6 h-6" />
            </div>
            <span className="text-[9px] font-extrabold text-indigo-600 bg-indigo-50/70 px-2.5 py-1 rounded-full uppercase tracking-wider font-sans">Aujourd'hui</span>
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest leading-none mb-1.5">Ventes Totales</p>
            <h3 className="text-2xl font-black text-slate-800 font-mono tracking-tight">{stats.dailyRevenue.toFixed(2)} <span className="text-sm font-extrabold text-slate-400">{currency}</span></h3>
          </div>
          <div className="flex items-center gap-1 text-xs text-indigo-600 font-bold bg-indigo-50/40 w-fit px-2 py-0.5 rounded-lg">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>{stats.todaySalesCount} transactions</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-xs premium-shadow space-y-4">
          <div className="flex items-center justify-between">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-xs">
              <DollarSign className="w-6 h-6" />
            </div>
            <span className="text-[9px] font-extrabold text-emerald-600 bg-emerald-50/70 px-2.5 py-1 rounded-full uppercase tracking-wider font-sans">Liquide</span>
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest leading-none mb-1.5">Revenus Encaissés</p>
            <h3 className="text-2xl font-black text-slate-800 font-mono tracking-tight">{stats.dailyPaid.toFixed(2)} <span className="text-sm font-extrabold text-slate-400">{currency}</span></h3>
          </div>
          <div className="text-xs text-slate-400 font-semibold bg-slate-50 w-fit px-2 py-0.5 rounded-lg border border-slate-100">
            Paiements perçus aujourd'hui
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-xs premium-shadow space-y-4">
          <div className="flex items-center justify-between">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center shadow-xs">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <span className="text-[9px] font-extrabold text-rose-600 bg-rose-50/70 px-2.5 py-1 rounded-full uppercase tracking-wider font-sans">Alerte</span>
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest leading-none mb-1.5">Stock Faible</p>
            <h3 className="text-2xl font-black text-slate-800 font-mono tracking-tight">{stats.lowStockCount}</h3>
          </div>
          <div className="flex items-center gap-1 text-xs text-rose-600 font-bold bg-rose-50/40 w-fit px-2 py-0.5 rounded-lg">
            <ArrowDownRight className="w-3.5 h-3.5" />
            <span>Articles à commander</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-xs premium-shadow space-y-4">
          <div className="flex items-center justify-between">
            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shadow-xs">
              <Users className="w-6 h-6" />
            </div>
            <span className="text-[9px] font-extrabold text-amber-600 bg-amber-50/70 px-2.5 py-1 rounded-full uppercase tracking-wider font-sans">Crédit</span>
          </div>
          <div>
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest leading-none mb-1.5">Nouvelles Dettes</p>
            <h3 className="text-2xl font-black text-slate-800 font-mono tracking-tight">{stats.dailyDebt.toFixed(2)} <span className="text-sm font-extrabold text-slate-400">{currency}</span></h3>
          </div>
          <div className="text-xs text-amber-600 font-semibold bg-amber-50/30 w-fit px-2 py-0.5 rounded-lg border border-amber-100/50">
            Crédits clients octroyés
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Products */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden">
          <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/30">
            <h2 className="font-extrabold text-slate-700 flex items-center gap-2 uppercase tracking-wide text-xs">
              <Package className="w-4 h-4 text-indigo-500" />
              Produits les plus vendus
            </h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {stats.topProducts.length === 0 ? (
                <p className="text-center text-slate-400 py-10 font-medium text-xs">Aucune vente enregistrée.</p>
              ) : (
                stats.topProducts.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-4 p-2 hover:bg-slate-50/70 rounded-xl transition-all duration-200">
                    <div className="w-8 h-8 rounded-lg bg-slate-100/80 flex items-center justify-center font-extrabold text-slate-500 text-xs shadow-xs">
                      #{idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-extrabold text-xs text-slate-700 truncate">{p.name}</h4>
                      <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{p.count} unités vendues</p>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-xs text-indigo-600 font-mono">{p.total.toFixed(2)} {currency}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden">
          <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/30">
            <h2 className="font-extrabold text-slate-700 flex items-center gap-2 uppercase tracking-wide text-xs">
              <ShoppingCart className="w-4 h-4 text-indigo-500" />
              Dernières Ventes
            </h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {sales.slice(0, 5).length === 0 ? (
                <p className="text-center text-slate-400 py-10 font-medium text-xs">Aucune vente récente.</p>
              ) : (
                sales.slice(0, 5).map((sale) => (
                  <div key={sale.id} className="flex items-center gap-4 p-2 hover:bg-slate-50/70 rounded-xl transition-all duration-200">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50/50 text-indigo-600 flex items-center justify-center shadow-xs">
                      <ShoppingCart className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-extrabold text-xs text-slate-700 truncate">{sale.clientName}</h4>
                      <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{sale.items.length} articles</p>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-xs text-slate-800 font-mono">{sale.total.toFixed(2)} {currency}</div>
                      <span className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider mt-1 scale-95 origin-right",
                        sale.debt > 0 
                          ? "bg-rose-50 text-rose-600 border border-rose-100" 
                          : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                      )}>
                        {sale.debt > 0 ? 'Partiel' : 'Payé'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
