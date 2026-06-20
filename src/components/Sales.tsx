import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Sale, Invoice } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Search, Calendar, User, ShoppingBag, Eye, X, Printer, ChevronRight, Download } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '../lib/utils';

export default function Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  const downloadPDF = async (sale: Sale) => {
    try {
      if (!sale.invoiceId) {
        alert("Aucune facture associée à cette vente.");
        return;
      }

      const invoiceSnap = await getDoc(doc(db, 'invoices', sale.invoiceId));
      if (!invoiceSnap.exists()) {
        alert("Facture introuvable.");
        return;
      }

      const invoice = { id: invoiceSnap.id, ...invoiceSnap.data() } as Invoice;

      const response = await fetch('/api/invoices/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...invoice,
          date: invoice.date?.toDate ? format(invoice.date.toDate(), 'dd/MM/yyyy HH:mm') : format(new Date(), 'dd/MM/yyyy HH:mm')
        })
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-${invoice.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (error) {
      console.error('Erreur PDF:', error);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'sales'), orderBy('date', 'desc'), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sls = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale));
      setSales(sls);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'sales');
    });
    return unsubscribe;
  }, []);

  const filteredSales = sales.filter(s => 
    s.clientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Historique des Ventes</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Consultez et gérez vos transactions passées</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        <div className="p-5 border-b border-slate-100 bg-slate-50/20">
          <div className="relative max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher par client ou ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:bg-white text-xs font-semibold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all duration-300"
            />
          </div>
        </div>

        <div className="overflow-x-auto text-[13px] font-medium text-slate-600">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400 text-[10px] font-extrabold uppercase tracking-widest">
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Total</th>
                <th className="px-6 py-4">Statut Paiement</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/70">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">Chargement...</td>
                </tr>
              ) : filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">Aucune vente trouvée.</td>
                </tr>
              ) : (
                filteredSales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        {sale.date?.toDate ? format(sale.date.toDate(), 'dd MMM yyyy HH:mm', { locale: fr }) : 'Date inconnue'}
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono uppercase tracking-tighter">ID: {sale.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">{sale.clientName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-black text-gray-900 font-mono">{sale.total.toFixed(2)} DT</div>
                    </td>
                    <td className="px-6 py-4">
                      {sale.debt > 0 ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
                          Partiel (-{sale.debt.toFixed(2)} DT)
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                          Payé
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedSale(sale)}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-100 flex flex-col max-h-[90vh]">
            <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div>
                <h2 className="text-xl font-black text-gray-900">Détails de la Vente</h2>
                <p className="text-xs text-gray-500 font-mono uppercase tracking-widest mt-1">ID: {selectedSale.id}</p>
              </div>
              <button onClick={() => setSelectedSale(null)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Client</label>
                  <div className="flex items-center gap-2 text-gray-900 font-bold">
                    <User className="w-5 h-5 text-indigo-600" />
                    {selectedSale.clientName}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Date & Heure</label>
                  <div className="flex items-center gap-2 text-gray-900 font-bold">
                    <Calendar className="w-5 h-5 text-indigo-600" />
                    {selectedSale.date?.toDate ? format(selectedSale.date.toDate(), 'PPP p', { locale: fr }) : 'Inconnue'}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4" /> Articles Vendus
                </label>
                <div className="bg-gray-50 rounded-2xl border border-gray-150 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-150">
                        <th className="px-6 py-3">Produit</th>
                        <th className="px-6 py-3 text-center">Qté</th>
                        <th className="px-6 py-3 text-right">Prix</th>
                        <th className="px-6 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-150">
                      {selectedSale.items.map((item, idx) => (
                        <tr key={idx} className="text-sm">
                          <td className="px-6 py-3 font-bold text-gray-900">{item.name}</td>
                          <td className="px-6 py-3 text-center font-mono">{item.quantity}</td>
                          <td className="px-6 py-3 text-right font-mono">{item.price.toFixed(2)}</td>
                          <td className="px-6 py-3 text-right font-black text-indigo-600 font-mono">{item.total.toFixed(2)} DT</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-gray-900 text-white p-8 rounded-3xl space-y-4 shadow-xl shadow-gray-900/20">
                <div className="flex justify-between items-center opacity-70">
                  <span className="text-sm uppercase tracking-widest font-bold">Total Vente</span>
                  <span className="font-mono">{selectedSale.total.toFixed(2)} DT</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm uppercase tracking-widest font-bold">Montant Payé</span>
                  <span className="text-xl font-black font-mono">{selectedSale.paid.toFixed(2)} DT</span>
                </div>
                {selectedSale.debt > 0 && (
                  <div className="flex justify-between items-center text-red-400 pt-2 border-t border-white/10">
                    <span className="text-sm uppercase tracking-widest font-bold">Reste à payer (Dette)</span>
                    <span className="text-xl font-black font-mono">{selectedSale.debt.toFixed(2)} DT</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-8 border-t border-gray-100 bg-gray-50/50 flex gap-4">
              <button 
                onClick={() => downloadPDF(selectedSale)}
                className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/15"
              >
                <Download className="w-5 h-5" />
                Télécharger PDF
              </button>
              <button 
                onClick={() => window.print()}
                className="flex-1 py-4 bg-white border border-gray-200 text-gray-900 font-bold rounded-2xl hover:bg-gray-100 transition-all flex items-center justify-center gap-2"
              >
                <Printer className="w-5 h-5" />
                Imprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
