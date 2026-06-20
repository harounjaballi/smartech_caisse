import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, query, orderBy, limit, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { Invoice, Product, Client, SaleItem, StoreSettings } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Search, FileText, Eye, X, Printer, Download, User, Calendar, ShoppingBag, Plus, Trash2, Minus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { PrintableTicket } from './PrintableTicket';

export default function Invoices() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isNewInvoiceModalOpen, setIsNewInvoiceModalOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  
  const handlePrint = () => {
    console.log('Impression du ticket en cours...', selectedInvoice);
    if (!selectedInvoice) {
      console.warn('Aucune facture sélectionnée pour l\'impression.');
      return;
    }
    // Small delay to ensure the ticket is rendered in the DOM
    setTimeout(() => {
      try {
        window.print();
      } catch (e) {
        console.error('Erreur lors de l\'impression:', e);
        alert('L\'impression a échoué. Veuillez essayer d\'ouvrir l\'application dans un nouvel onglet.');
      }
    }, 500);
  };
  
  // New Invoice Form State
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [paidAmountInput, setPaidAmountInput] = useState('0');
  const [isPaidFocused, setIsPaidFocused] = useState(false);

  useEffect(() => {
    if (!isPaidFocused) {
      setPaidAmountInput(paidAmount === 0 ? '' : paidAmount.toString());
    }
  }, [paidAmount, isPaidFocused]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [saleSuccess, setSaleSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'invoices'), orderBy('date', 'desc'), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const invs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invoice));
      setInvoices(invs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'invoices');
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'store'), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings');
    });

    return () => {
      unsubscribe();
      unsubscribeSettings();
    };
  }, []);

  useEffect(() => {
    if (isNewInvoiceModalOpen) {
      const unsubClients = onSnapshot(collection(db, 'clients'), (snap) => {
        setClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'clients');
      });
      const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
        setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'products');
      });
      return () => {
        unsubClients();
        unsubProducts();
      };
    }
  }, [isNewInvoiceModalOpen]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map(item => 
          item.productId === product.id 
            ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.price }
            : item
        );
      }
      return [...prev, {
        productId: product.id,
        name: product.name,
        quantity: 1,
        price: product.sellPrice,
        total: product.sellPrice
      }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId) {
        const product = products.find(p => p.id === productId);
        const newQty = Math.max(1, item.quantity + delta);
        if (product && newQty > product.stock) return item;
        return { ...item, quantity: newQty, total: newQty * item.price };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.total, 0), [cart]);
  const tvaRate = storeSettings?.tvaEnabled !== false ? (storeSettings?.tva || 19) / 100 : 0;
  const tvaAmount = subtotal * tvaRate;
  const cartTotal = subtotal + tvaAmount;

  useEffect(() => {
    setPaidAmount(cartTotal);
  }, [cartTotal]);

  const remainingDebt = Math.max(0, cartTotal - paidAmount);

  const filteredProducts = useMemo(() => 
    products.filter(p => 
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.barcode && p.barcode.toLowerCase().includes(productSearch.toLowerCase()))
    ), [products, productSearch]
  );

  const validateSale = async () => {
    if (cart.length === 0) return;
    setIsProcessing(true);
    setError(null);
    console.log('Starting invoice validation...', { cart, selectedClient, paidAmount });

    try {
      await runTransaction(db, async (transaction) => {
        console.log('Transaction started');
        
        // 1. ALL READS FIRST
        const counterRef = doc(db, 'counters', 'invoices');
        const counterSnap = await transaction.get(counterRef);
        
        const productSnaps = await Promise.all(
          cart.map(item => transaction.get(doc(db, 'products', item.productId)))
        );

        let clientSnap = null;
        if (selectedClient && remainingDebt > 0) {
          clientSnap = await transaction.get(doc(db, 'clients', selectedClient.id));
        }

        // 2. LOGIC & VALIDATION
        let nextNum = 1;
        if (counterSnap.exists()) {
          nextNum = (counterSnap.data().lastNum || 0) + 1;
        }
        console.log('Next invoice number:', nextNum);
        
        const year = new Date().getFullYear();
        const invoiceNumber = `FAC-${year}-${nextNum.toString().padStart(4, '0')}`;

        // Validate products and stock
        const stockUpdates: { ref: any, newStock: number }[] = [];
        for (let i = 0; i < cart.length; i++) {
          const item = cart[i];
          const productSnap = productSnaps[i];
          if (!productSnap.exists()) throw new Error(`Produit ${item.name} introuvable`);
          const currentStock = productSnap.data().stock || 0;
          if (currentStock < item.quantity) throw new Error(`Stock insuffisant pour ${item.name} (Disponible: ${currentStock})`);
          stockUpdates.push({
            ref: doc(db, 'products', item.productId),
            newStock: currentStock - item.quantity
          });
        }

        // Validate client
        let clientUpdate = null;
        if (selectedClient && remainingDebt > 0) {
          if (!clientSnap || !clientSnap.exists()) throw new Error(`Client introuvable`);
          const currentDebt = clientSnap.data().debt || 0;
          clientUpdate = {
            ref: doc(db, 'clients', selectedClient.id),
            newDebt: currentDebt + remainingDebt
          };
        }

        // 3. ALL WRITES LAST
        transaction.set(counterRef, { lastNum: nextNum }, { merge: true });

        for (const update of stockUpdates) {
          transaction.update(update.ref, { stock: update.newStock });
        }

        if (clientUpdate) {
          transaction.update(clientUpdate.ref, { debt: clientUpdate.newDebt });
        }

        const saleRef = doc(collection(db, 'sales'));
        const invoiceRef = doc(collection(db, 'invoices'));

        const saleData = {
          date: serverTimestamp(),
          clientId: selectedClient?.id || null,
          clientCode: selectedClient?.code || '',
          clientName: selectedClient?.name || 'Client de passage',
          total: cartTotal,
          paid: paidAmount,
          debt: remainingDebt,
          tva: tvaAmount,
          items: cart,
          invoiceId: invoiceRef.id
        };

        const invoiceData = {
          id: invoiceRef.id,
          number: invoiceNumber,
          saleId: saleRef.id,
          clientId: selectedClient?.id || null,
          clientCode: selectedClient?.code || '',
          clientName: selectedClient?.name || 'Client de passage',
          clientPhone: selectedClient?.phone || '',
          clientAddress: selectedClient?.address || '',
          total: cartTotal,
          paid: paidAmount,
          debt: remainingDebt,
          tva: tvaAmount,
          date: serverTimestamp(),
          items: cart
        };

        transaction.set(saleRef, saleData);
        transaction.set(invoiceRef, invoiceData);
        console.log('Transaction operations queued');
      });

      console.log('Transaction committed successfully');
      setSaleSuccess('Facture créée avec succès !');
      setTimeout(() => {
        setSaleSuccess(null);
        setIsNewInvoiceModalOpen(false);
        setCart([]);
        setPaidAmount(0);
        setSelectedClient(null);
      }, 2000);
    } catch (err: any) {
      console.error('Transaction failed:', err);
      setError(err.message);
      handleFirestoreError(err, OperationType.WRITE, 'sales');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadPDF = async (invoice: Invoice) => {
    try {
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

  const filteredInvoices = invoices.filter(inv => 
    inv.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (inv.clientCode && inv.clientCode.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6 relative">
      {/* Hidden printable ticket for Invoices - Render outside #root using Portal */}
      {createPortal(
        <div className="print-container">
          {selectedInvoice && (
            <PrintableTicket invoice={selectedInvoice} />
          )}
        </div>,
        document.body
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Factures</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Gérez et téléchargez vos factures de vente</p>
        </div>
        <button
          onClick={() => setIsNewInvoiceModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-350 shadow-lg shadow-emerald-600/15 group hover:-translate-y-0.5"
        >
          <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" />
          Nouvelle Facture
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        <div className="p-5 border-b border-slate-100 bg-slate-50/20">
          <div className="relative max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher par numéro ou client..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl focus:bg-white text-xs font-semibold text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all duration-300"
            />
          </div>
        </div>

        <div className="overflow-x-auto text-[13px] font-medium text-slate-600">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400 text-[10px] font-extrabold uppercase tracking-widest">
                <th className="px-6 py-4">N° Facture</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Total</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/70">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">Chargement...</td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">Aucune facture trouvée.</td>
                </tr>
              ) : (
                filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-bold text-gray-900">{invoice.number}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {invoice.date?.toDate ? format(invoice.date.toDate(), 'dd MMM yyyy', { locale: fr }) : 'Inconnue'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{invoice.clientName}</div>
                      {invoice.clientCode && <div className="text-[10px] text-gray-400 font-mono uppercase tracking-tighter">Code: {invoice.clientCode}</div>}
                    </td>
                    <td className="px-6 py-4 font-black text-gray-900 font-mono">{invoice.total.toFixed(2)} {storeSettings?.currency || 'DT'}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setSelectedInvoice(invoice)}
                          className="p-2 text-gray-400 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => downloadPDF(invoice)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Download className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Invoice Modal */}
      {isNewInvoiceModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl overflow-hidden border border-green-800 flex flex-col h-[90vh]">
            <div className="px-8 py-6 border-b border-green-800 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 text-green-700 rounded-xl">
                  <Plus className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-gray-900">Nouvelle Facture</h2>
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-0.5">Création manuelle d'une facture</p>
                </div>
              </div>
              <button onClick={() => setIsNewInvoiceModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              {/* Left Side: Product Selection */}
              <div className="flex-1 flex flex-col border-r border-green-800 bg-gray-50/30">
                <div className="p-6 space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Rechercher un produit..."
                      className="w-full pl-10 pr-4 py-3 bg-white border border-green-800 rounded-2xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 overflow-y-auto max-h-[50vh] pr-2">
                    {filteredProducts.map(product => (
                      <button
                        key={product.id}
                        onClick={() => addToCart(product)}
                        disabled={product.stock <= 0}
                        className={cn(
                          "p-4 rounded-2xl border text-left transition-all group relative overflow-hidden",
                          product.stock > 0 
                            ? "bg-white border-green-800 hover:border-green-500 hover:shadow-md active:scale-95" 
                            : "bg-gray-50 border-green-800 opacity-60 grayscale cursor-not-allowed"
                        )}
                      >
                        <div className="font-bold text-gray-900 truncate">{product.name}</div>
                        <div className="text-xs text-gray-500 mt-1 font-mono">{product.sellPrice.toFixed(2)} {storeSettings?.currency || 'DT'}</div>
                        <div className={cn(
                          "text-[10px] font-bold mt-2 uppercase tracking-tighter",
                          product.stock <= (product.lowStockAlert || 5) ? "text-red-500" : "text-green-600"
                        )}>
                          Stock: {product.stock}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Side: Cart & Client */}
              <div className="w-full md:w-[400px] flex flex-col bg-white">
                <div className="p-6 border-b border-green-800 space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2">Client</label>
                    <select
                      className="w-full px-4 py-3 bg-gray-50 border border-green-800 rounded-2xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all text-sm font-medium"
                      value={selectedClient?.id || ''}
                      onChange={(e) => {
                        const client = clients.find(c => c.id === e.target.value);
                        setSelectedClient(client || null);
                      }}
                    >
                      <option value="">Client de passage</option>
                      {clients.map(client => (
                        <option key={client.id} value={client.id}>
                          {client.name} {client.code ? `(${client.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Articles</label>
                  {cart.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 italic text-sm">Panier vide</div>
                  ) : (
                    <div className="space-y-3">
                      {cart.map(item => (
                        <div key={item.productId} className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl border border-green-800">
                          <div className="flex-1 min-w-0 pr-4">
                            <div className="font-bold text-gray-900 text-sm truncate">{item.name}</div>
                            <div className="text-xs text-gray-500 font-mono">{item.price.toFixed(2)} {storeSettings?.currency || 'DT'} x {item.quantity}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => updateQuantity(item.productId, -1)} className="p-1 hover:bg-white rounded-lg text-gray-400 hover:text-gray-600">
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="w-6 text-center font-bold text-sm">{item.quantity}</span>
                            <button onClick={() => updateQuantity(item.productId, 1)} className="p-1 hover:bg-white rounded-lg text-gray-400 hover:text-gray-600">
                              <Plus className="w-4 h-4" />
                            </button>
                            <button onClick={() => removeFromCart(item.productId)} className="ml-2 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-6 bg-gray-50 border-t border-green-800 space-y-4">
                  <div className="space-y-2">
                    {storeSettings?.tvaEnabled !== false && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Sous-total</span>
                        <span className="font-mono font-bold">{subtotal.toFixed(2)} {storeSettings?.currency || 'DT'}</span>
                      </div>
                    )}
                    {storeSettings?.tvaEnabled !== false && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">TVA ({storeSettings?.tva || 19}%)</span>
                        <span className="font-mono font-bold">{tvaAmount.toFixed(2)} {storeSettings?.currency || 'DT'}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg pt-2 border-t border-green-800">
                      <span className="font-black text-gray-900">TOTAL</span>
                      <span className="font-black text-green-700 font-mono">{cartTotal.toFixed(2)} {storeSettings?.currency || 'DT'}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Montant Payé</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full px-4 py-3 bg-white border border-green-800 rounded-2xl focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none font-mono font-bold"
                      value={paidAmountInput}
                      onFocus={() => setIsPaidFocused(true)}
                      onBlur={() => {
                        setIsPaidFocused(false);
                        const parsed = parseFloat(paidAmountInput) || 0;
                        setPaidAmountInput(parsed === 0 ? '' : parsed.toString());
                        setPaidAmount(parsed);
                      }}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setPaidAmountInput(value);
                          setPaidAmount(parseFloat(value) || 0);
                        }
                      }}
                      placeholder="0.00"
                    />
                  </div>

                  {remainingDebt > 0 && (
                    <div className="p-3 bg-red-50 rounded-xl border border-red-100 flex items-center justify-between">
                      <span className="text-xs font-bold text-red-700 uppercase tracking-widest">Dette</span>
                      <span className="font-mono font-bold text-red-700">{remainingDebt.toFixed(2)} {storeSettings?.currency || 'DT'}</span>
                    </div>
                  )}

                  {error && (
                    <div className="p-3 bg-red-50 rounded-xl border border-red-100 flex items-center gap-2 text-red-700">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span className="text-xs font-bold">{error}</span>
                    </div>
                  )}

                  <button
                    onClick={validateSale}
                    disabled={isProcessing || cart.length === 0}
                    className={cn(
                      "w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg",
                      isProcessing || cart.length === 0
                        ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                        : "bg-green-700 text-white hover:bg-green-800 shadow-green-700/20"
                    )}
                  >
                    {isProcessing ? (
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        Valider la Facture
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {saleSuccess && (
        <div className="fixed bottom-8 right-8 z-[100] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-green-900 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-green-800">
            <div className="bg-green-800 p-1.5 rounded-lg">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <span className="font-bold">{saleSuccess}</span>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-green-800 flex flex-col max-h-[90vh]">
            <div className="px-8 py-6 border-b border-green-800 flex items-center justify-between bg-gray-50/50">
              <div>
                <h2 className="text-xl font-black text-gray-900">Facture {selectedInvoice.number}</h2>
                <p className="text-xs text-gray-500 font-mono uppercase tracking-widest mt-1">Date: {selectedInvoice.date?.toDate ? format(selectedInvoice.date.toDate(), 'PPP p', { locale: fr }) : 'Inconnue'}</p>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Client</label>
                  <div className="text-gray-900 font-bold">{selectedInvoice.clientName}</div>
                  {selectedInvoice.clientCode && <div className="text-xs text-gray-500 font-mono">Code: {selectedInvoice.clientCode}</div>}
                  {selectedInvoice.clientPhone && <div className="text-xs text-gray-500">{selectedInvoice.clientPhone}</div>}
                  {selectedInvoice.clientAddress && <div className="text-xs text-gray-500 italic">{selectedInvoice.clientAddress}</div>}
                </div>
                <div className="space-y-1 text-right">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Magasin</label>
                  <div className="text-gray-900 font-bold text-green-700">{storeSettings?.storeName || 'SmarTech Solution'}</div>
                  <div className="text-xs text-gray-500">{storeSettings?.address || 'Tunisie'}</div>
                  {storeSettings?.phone && <div className="text-xs text-gray-500">{storeSettings.phone}</div>}
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-50 rounded-2xl border border-green-800 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-green-800">
                        <th className="px-6 py-3">Produit</th>
                        <th className="px-6 py-3 text-center">Qté</th>
                        <th className="px-6 py-3 text-right">Prix</th>
                        <th className="px-6 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-green-800">
                      {selectedInvoice.items.map((item, idx) => (
                        <tr key={idx} className="text-sm">
                          <td className="px-6 py-3 font-bold text-gray-900">{item.name}</td>
                          <td className="px-6 py-3 text-center font-mono">{item.quantity}</td>
                          <td className="px-6 py-3 text-right font-mono">{item.price.toFixed(2)}</td>
                          <td className="px-6 py-3 text-right font-black text-green-700 font-mono">{item.total.toFixed(2)} {storeSettings?.currency || 'DT'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-gray-900 text-white p-8 rounded-3xl space-y-4 shadow-xl shadow-gray-900/20">
                {selectedInvoice.tva > 0 && (
                  <div className="flex justify-between items-center opacity-70">
                    <span className="text-sm uppercase tracking-widest font-bold">Sous-total</span>
                    <span className="font-mono">{(selectedInvoice.total - selectedInvoice.tva).toFixed(2)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                )}
                {selectedInvoice.tva > 0 && (
                  <div className="flex justify-between items-center opacity-70">
                    <span className="text-sm uppercase tracking-widest font-bold">TVA ({storeSettings?.tva || 19}%)</span>
                    <span className="font-mono">{selectedInvoice.tva.toFixed(2)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-white/10">
                  <span className="text-sm uppercase tracking-widest font-bold">Total Général</span>
                  <span className="text-2xl font-black font-mono">{selectedInvoice.total.toFixed(2)} {storeSettings?.currency || 'DT'}</span>
                </div>
                <div className="flex justify-between items-center opacity-70">
                  <span className="text-sm uppercase tracking-widest font-bold">Payé</span>
                  <span className="font-mono">{selectedInvoice.paid.toFixed(2)} {storeSettings?.currency || 'DT'}</span>
                </div>
                {selectedInvoice.debt > 0 && (
                  <div className="flex justify-between items-center text-red-400 pt-2 border-t border-white/10">
                    <span className="text-sm uppercase tracking-widest font-bold">Reste à payer</span>
                    <span className="text-xl font-black font-mono">{selectedInvoice.debt.toFixed(2)} {storeSettings?.currency || 'DT'}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-8 border-t border-green-800 bg-gray-50/50 flex gap-4">
              <button 
                onClick={() => downloadPDF(selectedInvoice)}
                className="flex-1 py-4 bg-green-700 text-white font-bold rounded-2xl hover:bg-green-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-700/20"
              >
                <Download className="w-5 h-5" />
                Télécharger PDF
              </button>
              <button 
                onClick={handlePrint}
                className="flex-1 py-4 bg-white border border-green-800 text-gray-900 font-bold rounded-2xl hover:bg-gray-100 transition-all flex items-center justify-center gap-2"
              >
                <Printer className="w-5 h-5" />
                Imprimer Ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
