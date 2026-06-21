import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy, serverTimestamp, runTransaction, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Product, Client, SaleItem, Sale, Invoice, Category, StoreSettings } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Search, ShoppingCart, Trash2, Plus, Minus, User, CreditCard, CheckCircle, AlertCircle, Printer, X, FileText, Barcode, Filter, Tag } from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { PrintableTicket } from './PrintableTicket';

export default function POS() {
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
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
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [scannerActive, setScannerActive] = useState(true);
  const [scanNotification, setScanNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handlePrint = () => {
    console.log('Impression du ticket en cours...', lastInvoice);
    if (!lastInvoice) {
      console.warn('Aucune facture à imprimer.');
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

  useEffect(() => {
    const unsubscribeProds = onSnapshot(query(collection(db, 'products'), orderBy('name')), (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'products');
    });
    const unsubscribeClients = onSnapshot(query(collection(db, 'clients'), orderBy('name')), (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'clients');
    });
    const unsubscribeCats = onSnapshot(query(collection(db, 'categories'), orderBy('name')), (snapshot) => {
      setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'categories');
    });
    const unsubscribeStore = onSnapshot(doc(db, 'settings', 'store'), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'settings/store');
    });
    return () => {
      unsubscribeProds();
      unsubscribeClients();
      unsubscribeCats();
      unsubscribeStore();
    };
  }, []);

  // Auto-clear helper for scan notification
  useEffect(() => {
    if (scanNotification) {
      const timer = setTimeout(() => setScanNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [scanNotification]);

  // Audio synths for scanner beeps
  const playBeep = (type: 'success' | 'error') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (type === 'success') {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 950;
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.12);
      } else {
        // Double low pitch beep for error
        [0, 120].forEach((delay) => {
          setTimeout(() => {
            try {
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              osc.type = 'sawtooth';
              osc.frequency.value = 180;
              gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
              osc.connect(gain);
              gain.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.15);
            } catch (innerErr) {
              console.warn(innerErr);
            }
          }, delay);
        });
      }
    } catch (err) {
      console.warn('Audio feedback failed (might require user interaction first):', err);
    }
  };

  // Global barcode reader logic for physical laser scanners (douchette)
  useEffect(() => {
    if (!scannerActive) return;

    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;

      const now = Date.now();
      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      
      // If user is actively typing in an input, let the browser handle keyboard events natively to prevent conflicts
      if (isInputFocused) {
        return;
      }

      const interval = lastKeyTime ? now - lastKeyTime : 0;
      lastKeyTime = now;

      if (e.key.length === 1) {
        // Physical barcode scanners transmit keyboard events at high speed (usually < 50ms)
        // If the interval is high (> 120ms), it's either the very first character of a scan or human keystrokes.
        // We set it as the new first character of our buffer.
        if (interval > 120) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
      } else if (e.key === 'Enter') {
        const barcode = buffer.trim();
        buffer = ''; // reset buffer
        lastKeyTime = 0;

        if (barcode.length >= 3) {
          // Find matching product
          const matchedProduct = products.find(p => p.barcode === barcode);
          if (matchedProduct) {
            if (matchedProduct.stock <= 0) {
              setScanNotification({
                message: `Rupture de Stock pour ${matchedProduct.name}`,
                type: 'error'
              });
              playBeep('error');
            } else {
              addToCart(matchedProduct);
              setScanNotification({
                message: `Code : ${barcode} | Ajouté : ${matchedProduct.name}`,
                type: 'success'
              });
              playBeep('success');
            }
            e.preventDefault();
            e.stopPropagation();
          } else {
            setScanNotification({
              message: `Code non reconnu : ${barcode}`,
              type: 'error'
            });
            playBeep('error');
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [scannerActive, products]);

  const filteredProducts = useMemo(() => 
    products.filter(p => 
      (p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
       (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase()))) && 
      (selectedCategory === 'all' || p.category === selectedCategory) &&
      p.stock > 0
    ),
    [products, searchTerm, selectedCategory]
  );

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchTerm.trim() !== '') {
      // Try to find exact barcode match
      const product = products.find(p => p.barcode === searchTerm.trim() && p.stock > 0);
      if (product) {
        addToCart(product);
        setSearchTerm('');
        e.preventDefault();
      }
    }
  };

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          setError(`Stock insuffisant pour ${product.name} (Disponible: ${product.stock})`);
          setTimeout(() => setError(null), 3000);
          return prev;
        }
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
        
        if (product) {
          if (newQty > product.stock) {
            setError(`Stock insuffisant pour ${item.name} (Disponible: ${product.stock})`);
            setTimeout(() => setError(null), 3000);
            return item;
          }
        }
        
        return { ...item, quantity: newQty, total: newQty * item.price };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.total, 0), [cart]);
  const currency = storeSettings?.currency || 'DT';
  const tvaRate = storeSettings?.tvaEnabled !== false ? (storeSettings?.tva || 19) / 100 : 0;
  const tvaAmount = subtotal * tvaRate;
  const cartTotal = subtotal + tvaAmount;

  useEffect(() => {
    setPaidAmount(cartTotal);
  }, [cartTotal]);

  const remainingDebt = Math.max(0, cartTotal - paidAmount);

  const downloadPDF = async (invoice: Invoice) => {
    try {
      const response = await fetch('/api/invoices/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...invoice,
          date: format(new Date(), 'dd/MM/yyyy HH:mm')
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

  const validateSale = async () => {
    if (cart.length === 0) return;
    setIsProcessing(true);
    setError(null);
    console.log('Starting POS validation...', { cart, selectedClient, paidAmount });

    try {
      let generatedInvoice: Invoice | null = null;

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
        
        generatedInvoice = invoiceData as any;
        console.log('Transaction operations queued');
      });

      console.log('Transaction committed successfully');
      setSaleSuccess('Vente validée avec succès !');
      setLastInvoice(generatedInvoice);
      setCart([]);
      setPaidAmount(0);
      setSelectedClient(null);
    } catch (err: any) {
      console.error('Transaction failed:', err);
      setError(err.message);
      handleFirestoreError(err, OperationType.WRITE, 'sales');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:h-[calc(100vh-130px)] min-h-0 relative">
      {/* Hidden printable ticket for POS - Render outside #root using Portal */}
      {createPortal(
        <div className="print-container">
          {lastInvoice && (
            <PrintableTicket invoice={lastInvoice} />
          )}
        </div>,
        document.body
      )}

      {/* Floating Scan Notification */}
      {scanNotification && (
        <div className={cn(
          "absolute top-4 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-2.5 px-4 py-2.5 rounded-full shadow-lg border text-xs font-black animate-in fade-in slide-in-from-top-4 duration-300 backdrop-blur-md transition-all",
          scanNotification.type === 'success' 
            ? "bg-emerald-50/90 border-emerald-200 text-emerald-800" 
            : "bg-rose-50/90 border-rose-200 text-rose-800"
        )}>
          <div className={cn(
            "w-2 h-2 rounded-full animate-ping shrink-0",
            scanNotification.type === 'success' ? "bg-emerald-500" : "bg-rose-500"
          )} />
          <span>{scanNotification.message}</span>
        </div>
      )}

      {/* Left: Product Selection */}
      <div className="lg:col-span-5 flex flex-col gap-4 min-h-0">
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <div className="flex flex-col gap-2.5 bg-slate-50 border border-slate-100 p-3.5 rounded-2xl relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="relative flex items-center justify-center">
                  <Barcode className={cn("w-5 h-5 text-indigo-600", scannerActive && "animate-pulse")} />
                  {scannerActive && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full animate-ping" />}
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-xs font-black text-slate-800 uppercase tracking-wider">Douchette Laser</span>
                  <span className="text-[10px] text-slate-500 font-bold font-sans">Ecoute automatique ou saisie directe</span>
                </div>
              </div>
              <button
                onClick={() => setScannerActive(!scannerActive)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border cursor-pointer",
                  scannerActive
                    ? "bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/10"
                    : "bg-slate-200 text-slate-600 border-slate-300"
                )}
              >
                {scannerActive ? "Actif" : "Inactif"}
              </button>
            </div>

            {scannerActive && (
              <div className="mt-2 text-left bg-emerald-50/50 border border-emerald-100 p-2.5 rounded-xl flex flex-col gap-2 animate-in fade-in duration-300">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Barcode className="h-4 w-4 text-emerald-600 animate-pulse animate-duration-1000" />
                  </div>
                  <input
                    type="text"
                    placeholder="Saisie manuelle ou scan douchette direct ici..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const code = e.currentTarget.value.trim();
                        if (code !== '') {
                          const matchedProduct = products.find(p => p.barcode === code);
                          if (matchedProduct) {
                            if (matchedProduct.stock <= 0) {
                              setScanNotification({
                                message: `Rupture de Stock : ${matchedProduct.name}`,
                                type: 'error'
                              });
                              playBeep('error');
                            } else {
                              addToCart(matchedProduct);
                              setScanNotification({
                                message: `Flashé ! ${matchedProduct.name}`,
                                type: 'success'
                              });
                              playBeep('success');
                            }
                          } else {
                            setScanNotification({
                              message: `Code article inconnu : ${code}`,
                              type: 'error'
                            });
                            playBeep('error');
                          }
                          e.currentTarget.value = '';
                        }
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                    className="block w-full pl-9 pr-3 py-1.5 bg-white border border-emerald-200 rounded-lg text-xs font-mono font-bold tracking-wider placeholder:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-emerald-950 transition-all shadow-3xs"
                  />
                </div>
                <div className="flex items-center gap-1.5 text-[9px] font-semibold text-emerald-700/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Ciblez ce champ ou scannez n'importe où sur l'écran ! Supports multi-générations.</span>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher ou scanner un code à barre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              autoFocus
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setSelectedCategory('all')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border",
                selectedCategory === 'all' 
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-600/10" 
                  : "bg-white text-gray-600 border-gray-200 hover:border-indigo-500"
              )}
            >
              Tous
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.name)}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border",
                  selectedCategory === cat.name 
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-600/10" 
                    : "bg-white text-gray-600 border-gray-200 hover:border-indigo-500"
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 pb-4 pr-2">
          {filteredProducts.map((product) => (
            <button
              key={product.id}
              onClick={() => addToCart(product)}
              disabled={product.stock <= 0}
              className={cn(
                "bg-white p-4 rounded-2xl border border-gray-100 shadow-sm hover:border-indigo-500 hover:shadow-md hover:shadow-indigo-50/50 transition-all text-left flex flex-col group relative",
                product.stock <= 0 && "opacity-60 grayscale cursor-not-allowed"
              )}
            >
              <div className="flex justify-between items-start mb-2">
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                  (() => {
                    const cat = categories.find(c => c.name === product.category);
                    if (!cat) return "bg-indigo-50 text-indigo-600";
                    return cat.type === 'boissons' ? "bg-blue-50 text-blue-600" :
                           cat.type === 'entretien' ? "bg-orange-50 text-orange-600" :
                           cat.type === 'frais' ? "bg-purple-50 text-purple-600" :
                           "bg-indigo-50 text-indigo-600";
                  })()
                )}>
                  {product.category}
                </span>
                <div className="flex flex-col items-end">
                  <span className={cn(
                    "text-[10px] font-medium",
                    product.stock <= 5 ? "text-red-500 font-bold" : "text-gray-400"
                  )}>
                    Stock: {product.stock}
                  </span>
                  {product.barcode && <span className="text-[9px] font-mono text-blue-500 bg-blue-50 px-1 rounded mt-0.5">{product.barcode}</span>}
                </div>
              </div>
              <h3 className="font-bold text-gray-900 mb-1 line-clamp-2 group-hover:text-indigo-600">{product.name}</h3>
              <div className="mt-auto pt-2 flex items-center justify-between">
                <span className="text-lg font-black text-indigo-600">{product.sellPrice.toFixed(2)} <span className="text-xs">{currency}</span></span>
                <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-200">
                  <Plus className="w-5 h-5" />
                </div>
              </div>
              {product.stock <= 0 && (
                <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] rounded-2xl flex items-center justify-center">
                  <div className="bg-red-600 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">
                    Rupture de Stock
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Cart & Checkout */}
      <div className="lg:col-span-7 flex flex-col gap-4 min-h-0">
        <div className="bg-white rounded-3xl border border-slate-100 shadow-xs flex flex-col lg:flex-row flex-1 overflow-hidden h-full premium-shadow">
          {/* Left panel: Product list inside cart - has full height and vertical freedom */}
          <div className="flex-1 lg:flex-[1.2] flex flex-col min-w-0 border-r border-slate-50">
            <div className="p-4 border-b border-slate-50 flex items-center justify-between bg-slate-50/20">
              <h2 className="font-extrabold text-slate-700 flex items-center gap-2 text-xs uppercase tracking-wide">
                <ShoppingCart className="w-4 h-4 text-indigo-500" />
                Liste du Panier ({cart.length})
              </h2>
              <button 
                onClick={() => setCart([])}
                className="text-xs font-black text-rose-500 hover:text-rose-600 transition-colors uppercase tracking-wider"
              >
                Vider le panier
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {cart.length === 0 ? (
                <div className="h-full py-16 flex flex-col items-center justify-center text-slate-300 gap-3">
                  <ShoppingCart className="w-12 h-12 opacity-35" />
                  <p className="text-xs uppercase tracking-wider font-extrabold">Le panier est vide</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between gap-3 p-3 bg-slate-50/40 hover:bg-slate-50 rounded-2xl border border-slate-100/50 transition-all duration-200">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-extrabold text-xs text-slate-850 truncate" title={item.name}>{item.name}</h4>
                      <p className="text-[10px] text-slate-450 font-bold mt-0.5">{item.price.toFixed(2)} {currency} / unité</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button 
                        onClick={() => updateQuantity(item.productId, -1)}
                        disabled={item.quantity <= 1}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-150 flex items-center justify-center hover:border-indigo-300 hover:text-indigo-650 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-xs"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-6 text-center font-bold text-xs text-slate-700">{item.quantity}</span>
                      <button 
                        onClick={() => updateQuantity(item.productId, 1)}
                        disabled={(() => {
                          const p = products.find(prod => prod.id === item.productId);
                          return p ? item.quantity >= p.stock : false;
                        })()}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-150 flex items-center justify-center hover:border-indigo-300 hover:text-indigo-650 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-right min-w-[75px] shrink-0">
                      <div className="font-bold text-xs text-indigo-650 font-mono">{item.total.toFixed(2)} {currency}</div>
                      <button 
                        onClick={() => removeFromCart(item.productId)}
                        className="text-[10px] font-bold text-rose-500 hover:text-rose-650 mt-1 inline-block hover:underline"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right panel: Checkout Details and validation (beautifully isolated from list height) */}
          <div className="w-full lg:w-[42%] flex flex-col bg-slate-50/30 border-t lg:border-t-0 border-slate-100">
            <div className="p-4 border-b border-slate-100 font-extrabold text-slate-500 text-xs uppercase tracking-wider flex items-center gap-2 bg-slate-50/20">
              <User className="w-4.5 h-4.5 text-indigo-500" />
              Règlement & Client
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Client Selection */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">
                  Client
                </label>
                <select
                  value={selectedClient?.id || ''}
                  onChange={(e) => {
                    const client = clients.find(c => c.id === e.target.value);
                    setSelectedClient(client || null);
                  }}
                  className="w-full px-3 py-2.5 bg-white border border-slate-100 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-shadow shadow-xs"
                >
                  <option value="">Client de passage</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.phone || 'Pas de tel'})</option>
                  ))}
                </select>
              </div>

              {/* Price Breakdown */}
              <div className="space-y-2.5 pt-4 border-t border-slate-100">
                {storeSettings?.tvaEnabled !== false && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-slate-400">Sous-total</span>
                    <span className="font-mono font-bold text-slate-600">{subtotal.toFixed(2)} {currency}</span>
                  </div>
                )}
                {storeSettings?.tvaEnabled !== false && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-slate-400">TVA ({storeSettings?.tva || 19}%)</span>
                    <span className="font-mono font-bold text-slate-600">{tvaAmount.toFixed(2)} {currency}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-indigo-600 pt-3 border-t border-slate-100">
                  <span className="text-xs font-black uppercase tracking-wider">Total</span>
                  <span className="text-xl font-black font-mono">{cartTotal.toFixed(2)} {currency}</span>
                </div>
              </div>

              {/* Payment Section */}
              <div className="space-y-2 pt-4 border-t border-slate-100">
                <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">Montant Payé ({currency})</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      inputMode="decimal"
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
                      className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-100 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 font-extrabold text-slate-800"
                    />
                  </div>
                  <button 
                    onClick={() => setPaidAmount(cartTotal)}
                    className="px-3 py-2.5 bg-indigo-55/70 hover:bg-indigo-65 text-indigo-600 border border-indigo-100 hover:text-indigo-700 text-[10px] font-extrabold uppercase rounded-xl transition-colors shadow-xs"
                  >
                    Total
                  </button>
                </div>

                {remainingDebt > 0 && (
                  <div className="p-3 bg-rose-50/50 border border-rose-100/60 rounded-xl flex items-center justify-between mt-1 animate-in fade-in duration-200">
                    <div className="flex items-center gap-1.5 text-rose-700">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span className="text-[9px] font-black uppercase tracking-wider">Reste (Dette)</span>
                    </div>
                    <span className="font-black text-xs text-rose-700 font-mono">{remainingDebt.toFixed(2)} {currency}</span>
                  </div>
                )}

                {error && (
                  <div className="p-3 bg-rose-50/50 rounded-xl border border-rose-100 flex items-center gap-1.5 text-rose-700">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs font-bold leading-tight">{error}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-white border-t border-slate-50">
              <button
                onClick={validateSale}
                disabled={cart.length === 0 || isProcessing}
                className="w-full py-3.5 bg-indigo-600 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl hover:bg-indigo-75 active:scale-[0.98] transition-all shadow-lg shadow-indigo-600/15 disabled:opacity-40 disabled:scale-100 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {isProcessing ? 'Traitement...' : (
                  <>
                    <CheckCircle className="w-5 h-5 shrink-0" />
                    Valider la Vente
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Success Overlay */}
      {saleSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white p-8 rounded-3xl shadow-2xl text-center max-w-sm w-full border border-gray-100 scale-in duration-300">
            <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-12 h-12" />
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">Succès !</h3>
            <p className="text-gray-500 mb-8">{saleSuccess}</p>
            
            <div className="space-y-3">
              {lastInvoice && (
                <button 
                  onClick={handlePrint}
                  className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Printer className="w-5 h-5" />
                  Imprimer Ticket
                </button>
              )}
              {lastInvoice && (
                <button 
                  onClick={() => downloadPDF(lastInvoice)}
                  className="w-full py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                >
                  <FileText className="w-5 h-5" />
                  Télécharger Facture PDF
                </button>
              )}
              <button 
                onClick={() => {
                  setSaleSuccess(null);
                  setLastInvoice(null);
                }}
                className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors"
              >
                Nouvelle Vente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
