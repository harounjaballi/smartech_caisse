import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc, collection, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { StoreSettings } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Edit2, X, Settings as SettingsIcon, CheckCircle2, Store, Save, Download, Trash2, Database, AlertTriangle, Calendar } from 'lucide-react';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';

export default function Settings() {
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state for store settings - always editable now
  const [storeFormData, setStoreFormData] = useState({
    storeName: '',
    currency: '',
    address: '',
    phone: '',
    tva: 19,
    tvaEnabled: true
  });

  // Database maintenance states
  const [isExporting, setIsExporting] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeDate, setPurgeDate] = useState('');
  const [purgeSales, setPurgeSales] = useState(true);
  const [purgeInvoices, setPurgeInvoices] = useState(true);

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      const productsSnap = await getDocs(collection(db, 'products'));
      const clientsSnap = await getDocs(collection(db, 'clients'));
      const salesSnap = await getDocs(collection(db, 'sales'));
      const invoicesSnap = await getDocs(collection(db, 'invoices'));

      const productsData = productsSnap.docs.map(doc => {
        const d = doc.data();
        return {
          'ID Produit': doc.id,
          'Nom de l\'article': d.name || '',
          'Catégorie': d.category || '',
          'Prix d\'achat (DT)': d.buyPrice || 0,
          'Prix de vente (DT)': d.sellPrice || 0,
          'Code à barre': d.barcode || '',
          'Stock restant': d.stock || 0,
          'Alerte Stock Bas': d.lowStockAlert || 0,
          'Date d\'expiration': d.expirationDate || ''
        };
      });

      const clientsData = clientsSnap.docs.map(doc => {
        const d = doc.data();
        return {
          'ID Client': doc.id,
          'Code Client': d.code || '',
          'Nom complet': d.name || '',
          'Téléphone': d.phone || '',
          'Adresse': d.address || '',
          'Dette Actuelle (DT)': d.debt || 0
        };
      });

      const salesData = salesSnap.docs.map(doc => {
        const d = doc.data();
        let formattedDate = '';
        if (d.date) {
          if (d.date.toDate) formattedDate = d.date.toDate().toLocaleDateString('fr-FR') + ' ' + d.date.toDate().toLocaleTimeString('fr-FR');
          else formattedDate = String(d.date);
        }
        const itemsString = d.items ? d.items.map((it: any) => `${it.name} (${it.quantity} x ${it.price} DT)`).join(', ') : '';
        return {
          'ID de la Vente': doc.id,
          'Date': formattedDate,
          'Client': d.clientName || 'Client de passage',
          'Total TTC (DT)': d.total || 0,
          'Montant payé (DT)': d.paid || 0,
          'Dette restante (DT)': d.debt || 0,
          'Montant TVA (DT)': d.tva || 0,
          'ID Facture associée': d.invoiceId || 'N/A',
          'Détail des Articles': itemsString
        };
      });

      const invoicesData = invoicesSnap.docs.map(doc => {
        const d = doc.data();
        let formattedDate = '';
        if (d.date) {
          if (d.date.toDate) formattedDate = d.date.toDate().toLocaleDateString('fr-FR') + ' ' + d.date.toDate().toLocaleTimeString('fr-FR');
          else formattedDate = String(d.date);
        }
        const itemsString = d.items ? d.items.map((it: any) => `${it.name} (${it.quantity} x ${it.price} DT)`).join(', ') : '';
        return {
          'ID de la Facture': doc.id,
          'Numéro de Facture': d.number || '',
          'ID de la Vente': d.saleId || '',
          'Nom Client': d.clientName || '',
          'Téléphone Client': d.clientPhone || '',
          'Adresse Client': d.clientAddress || '',
          'Total Facture (DT)': d.total || 0,
          'Payé (DT)': d.paid || 0,
          'Dette (DT)': d.debt || 0,
          'TVA (DT)': d.tva || 0,
          'Date de Facturation': formattedDate,
          'Articles': itemsString
        };
      });

      const wb = XLSX.utils.book_new();

      const productsSheet = XLSX.utils.json_to_sheet(productsData);
      const clientsSheet = XLSX.utils.json_to_sheet(clientsData);
      const salesSheet = XLSX.utils.json_to_sheet(salesData);
      const invoicesSheet = XLSX.utils.json_to_sheet(invoicesData);

      XLSX.utils.book_append_sheet(wb, productsSheet, 'Produits');
      XLSX.utils.book_append_sheet(wb, clientsSheet, 'Clients');
      XLSX.utils.book_append_sheet(wb, salesSheet, 'Ventes');
      XLSX.utils.book_append_sheet(wb, invoicesSheet, 'Factures');

      const fileName = `Export_Base_${(storeFormData.storeName || 'Magasin').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      setSuccess('Base de données exportée en fichier Excel avec succès !');
      setTimeout(() => setSuccess(null), 4000);
    } catch (error) {
      console.error('Erreur export :', error);
      alert('Une erreur est survenue lors de l\'exportation de la base de données.');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePurgeDatabase = async () => {
    if (!purgeDate) {
      alert("Veuillez sélectionner une date limite.");
      return;
    }

    const limitDate = new Date(purgeDate);
    limitDate.setHours(23, 59, 59, 999);

    const checkConfirm = window.confirm(
      `ATTENTION : Vous allez supprimer TOUTES les transactions antérieures au ${limitDate.toLocaleDateString('fr-FR')} incluse.\n\nCette action est irréversible et supprimera définitivement les données sélectionnées.\n\nÊtes-vous absolument sûr ?`
    );

    if (!checkConfirm) {
      return;
    }

    const confirmationInput = prompt(
      `Pour confirmer la suppression et l'allègement de la base, veuillez écrire le mot PURGER en majuscules :`
    );

    if (confirmationInput !== 'PURGER') {
      alert("Purge annulée. La confirmation tapée est incorrecte.");
      return;
    }

    setIsPurging(true);
    try {
      let salesDeleted = 0;
      let invoicesDeleted = 0;

      if (purgeSales) {
        const salesQuery = query(collection(db, 'sales'), where('date', '<=', limitDate));
        const salesSnap = await getDocs(salesQuery);
        for (const docSnap of salesSnap.docs) {
          await deleteDoc(docSnap.ref);
          salesDeleted++;
        }
      }

      if (purgeInvoices) {
        const invoicesQuery = query(collection(db, 'invoices'), where('date', '<=', limitDate));
        const invoicesSnap = await getDocs(invoicesQuery);
        for (const docSnap of invoicesSnap.docs) {
          await deleteDoc(docSnap.ref);
          invoicesDeleted++;
        }
      }

      setSuccess(`Purge complétée ! ${salesDeleted} ventes et ${invoicesDeleted} factures antérieures au ${limitDate.toLocaleDateString('fr-FR')} ont été définitivement nettoyées.`);
      setTimeout(() => setSuccess(null), 5000);
    } catch (error) {
      console.error('Erreur purge:', error);
      alert('Une erreur est survenue lors de la purge de la base de données.');
    } finally {
      setIsPurging(false);
    }
  };

  useEffect(() => {
    const unsubscribeStore = onSnapshot(doc(db, 'settings', 'store'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as StoreSettings;
        setStoreSettings({ ...data, id: snapshot.id });
        setStoreFormData({
          storeName: data.storeName || '',
          currency: data.currency || '',
          address: data.address || '',
          phone: data.phone || '',
          tva: data.tva !== undefined ? data.tva : 19,
          tvaEnabled: data.tvaEnabled !== false
        });
      } else {
        setStoreSettings({
          id: 'store',
          storeName: 'SmarTech Solution',
          currency: 'DT',
          tva: 19,
          tvaEnabled: true
        } as StoreSettings);
        setStoreFormData({
          storeName: 'SmarTech Solution',
          currency: 'DT',
          address: '',
          phone: '',
          tva: 19,
          tvaEnabled: true
        });
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings/store');
      setLoading(false);
    });

    return () => {
      unsubscribeStore();
    };
  }, []);

  const handleStoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'settings', 'store'), storeFormData);
      setSuccess('Paramètres du magasin enregistrés avec succès !');
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/store');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <SettingsIcon className="w-7 h-7 text-indigo-600 fill-indigo-100/40" />
            Paramètres du Magasin
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Configurez les informations d'en-tête, la devise, les coordonnées de contact et la gestion de la TVA.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-3xl border border-slate-100 p-16 flex items-center justify-center premium-shadow">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Card 1: Informations Générales de la Boutique */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 text-sm">Informations Générales</h2>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Coordonnées de l'activité imprimées sur les reçus</p>
              </div>
            </div>

            <div className="p-6">
              <form onSubmit={handleStoreSubmit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Nom du Boutique / Magasin</label>
                    <input 
                      type="text" 
                      required
                      value={storeFormData.storeName}
                      onChange={(e) => setStoreFormData({ ...storeFormData, storeName: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold transition-all outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                      placeholder="Ex: Mon Supermarché"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Devise du Magasin</label>
                    <input 
                      type="text" 
                      required
                      value={storeFormData.currency}
                      onChange={(e) => setStoreFormData({ ...storeFormData, currency: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold transition-all outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                      placeholder="Ex: DT"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Adresse</label>
                    <input 
                      type="text" 
                      value={storeFormData.address}
                      onChange={(e) => setStoreFormData({ ...storeFormData, address: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold transition-all outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                      placeholder="Ex: Avenue Habib Bourguiba, Tunis"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Téléphone du Magasin</label>
                    <input 
                      type="text" 
                      value={storeFormData.phone}
                      onChange={(e) => setStoreFormData({ ...storeFormData, phone: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold transition-all outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                      placeholder="Ex: 71 000 000 ou 22 123 456"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-2xl border border-slate-100 my-2">
                  <div>
                    <label className="text-xs font-bold text-slate-800 block">Facturation de la TVA</label>
                    <span className="text-[10px] text-slate-400 font-medium block leading-tight mt-0.5">Calculer et appliquer la taxe sur la valeur ajoutée sur les ventes</span>
                  </div>
                  <input 
                    type="checkbox"
                    checked={storeFormData.tvaEnabled}
                    onChange={(e) => setStoreFormData({ ...storeFormData, tvaEnabled: e.target.checked })}
                    className="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Taux de TVA (%)</label>
                  <input 
                    type="number" 
                    disabled={!storeFormData.tvaEnabled}
                    value={storeFormData.tva}
                    onChange={(e) => setStoreFormData({ ...storeFormData, tva: Number(e.target.value) })}
                    className={cn(
                      "w-full px-4 py-2.5 border rounded-xl text-xs font-semibold transition-all outline-none",
                      storeFormData.tvaEnabled
                        ? "bg-white border-indigo-200 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" 
                        : "bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                    )}
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-indigo-600/10 active:scale-[0.99]"
                  >
                    <Save className="w-4 h-4" />
                    Enregistrer les modifications
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Card 2: Configuration & Maintenance de la Base de Données */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow space-y-6 p-6">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 text-sm">Base de données & Maintenance</h2>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Outils d'archivage et d'allègement du magasin</p>
              </div>
            </div>

            {/* Rubrique 1: Sauvegarde Excel */}
            <div className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">1. Sauvegarde Complète (Excel)</h3>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                  Générez un fichier Excel multi-feuille contenant l'intégralité de la base de données (produits en stock, liste complète des clients, historique des ventes et factures).
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={isExporting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-emerald-500/10 active:scale-[0.99]"
              >
                <Download className="w-4 h-4 animate-bounce" />
                {isExporting ? 'Exportation en cours...' : 'Exporter toute la base de données (.xlsx)'}
              </button>
            </div>

            <hr className="border-slate-100" />

            {/* Rubrique 2: Nettoyage et Allègement de l'historique */}
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">2. Nettoyage de l'historique</h3>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                  Allégez la base de données en supprimant définitivement les rapports de transactions (ventes et factures) antérieurs à une date limite de votre choix.
                </p>
              </div>

              {/* Date limite */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-bold">Transactions antérieures ou égales au :</label>
                <div className="relative">
                  <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="date"
                    value={purgeDate}
                    onChange={(e) => setPurgeDate(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-rose-500/10 focus:border-rose-450 transition-shadow"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <label className="flex items-center gap-2 p-3 bg-slate-50/50 rounded-xl border border-slate-100 cursor-pointer hover:bg-slate-50">
                  <input 
                    type="checkbox" 
                    checked={purgeSales}
                    onChange={(e) => setPurgeSales(e.target.checked)}
                    className="w-4 h-4 text-rose-600 rounded border-slate-300 focus:ring-rose-500"
                  />
                  <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Purger les Ventes</span>
                </label>
                <label className="flex items-center gap-2 p-3 bg-slate-50/50 rounded-xl border border-slate-100 cursor-pointer hover:bg-slate-50">
                  <input 
                    type="checkbox" 
                    checked={purgeInvoices}
                    onChange={(e) => setPurgeInvoices(e.target.checked)}
                    className="w-4 h-4 text-rose-600 rounded border-slate-300 focus:ring-rose-500"
                  />
                  <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Purger les Factures</span>
                </label>
              </div>

              {/* Warning Area */}
              {purgeDate && (
                <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-2.5 text-rose-800 text-[11px] leading-relaxed animate-in fade-in duration-300">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5 animate-pulse" />
                  <div>
                    <span className="font-extrabold block uppercase tracking-wide text-[10px] text-rose-700">Alerte : Suppression définitive !</span>
                    Toutes les transactions correspondantes datées d'avant le <span className="font-bold underline">{new Date(purgeDate).toLocaleDateString('fr-FR')}</span> incluse seront définitivement supprimées afin d'alléger la base de données de caisse.
                  </div>
                </div>
              )}

              {/* Action Button */}
              <button
                type="button"
                onClick={handlePurgeDatabase}
                disabled={isPurging || !purgeDate || (!purgeSales && !purgeInvoices)}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-rose-600/10 active:scale-[0.99]"
              >
                <Trash2 className="w-4 h-4 font-bold" />
                {isPurging ? 'Purge et allègement en cours...' : 'Purger et alléger de la base'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {success && (
        <div className="fixed bottom-8 right-8 z-[100] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 border border-slate-850">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="text-xs font-extrabold">{success}</span>
          </div>
        </div>
      )}
    </div>
  );
}
