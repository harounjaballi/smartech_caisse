import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, setDoc, getDocs, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Product, Category, StoreSettings, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Plus, Search, Edit2, Trash2, X, AlertTriangle, Package, Tag, Barcode } from 'lucide-react';
import { cn, decodeAzertyBarcode } from '../lib/utils';
import { addPendingOperation } from '../lib/offlineManager';

interface ProductsProps {
  userProfile: UserProfile | null;
}

export default function Products({ userProfile }: ProductsProps) {
  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQuickCategoryModalOpen, setIsQuickCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanned' | 'error'>('idle');
  const [scanMessage, setScanMessage] = useState('');
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // States for stock replenishment modal
  const [replenishProduct, setReplenishProduct] = useState<Product | null>(null);
  const [replenishQty, setReplenishQty] = useState<string>('');
  const [replenishPrice, setReplenishPrice] = useState<string>('');

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
            } catch (innerErr) {}
          }, delay);
        });
      }
    } catch (err) {}
  };

  useEffect(() => {
    if (!isModalOpen) {
      setScanStatus('idle');
      setScanMessage('');
      return;
    }

    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;

      const now = Date.now();
      const target = e.target as HTMLElement;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      const isBarcodeInputFocused = target && target.tagName === 'INPUT' && (target as HTMLInputElement).placeholder?.includes('douchette');

      const interval = lastKeyTime ? now - lastKeyTime : 0;
      lastKeyTime = now;

      if (e.key.length === 1) {
        if (isInputFocused && !isBarcodeInputFocused && interval > 120) {
          buffer = e.key;
          return;
        }

        if (interval > 120) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
      } else if (e.key === 'Enter') {
        const barcode = decodeAzertyBarcode(buffer.trim());
        buffer = '';
        lastKeyTime = 0;

        if (barcode.length >= 3) {
          playBeep('success');
          setFormData(prev => ({ ...prev, barcode }));
          setScanStatus('scanned');
          setScanMessage(`Code détecté avec succès : ${barcode}`);
          setTimeout(() => {
            setScanStatus('idle');
            setScanMessage('');
          }, 4500);

          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isModalOpen]);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    buyPrice: 0,
    sellPrice: 0,
    barcode: '',
    stock: 0,
    expirationDate: '',
    lowStockAlert: 5
  });

  const [buyPriceInput, setBuyPriceInput] = useState('');
  const [sellPriceInput, setSellPriceInput] = useState('');

  useEffect(() => {
    const unsubscribeProds = onSnapshot(query(collection(db, 'products'), where('ownerId', '==', ownerId)), (snapshot) => {
      const prods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      prods.sort((a, b) => {
        const dateA = a.createdAt || '';
        const dateB = b.createdAt || '';
        if (dateA && dateB) {
          return dateB.localeCompare(dateA);
        }
        if (dateA) return -1;
        if (dateB) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      setProducts(prods);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
    });

    const unsubscribeCats = onSnapshot(query(collection(db, 'categories'), where('ownerId', '==', ownerId)), (snapshot) => {
      const cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
      cats.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCategories(cats);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'categories');
    });

    const unsubscribeSettings = onSnapshot(doc(db, 'settings', ownerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings');
    });

    return () => {
      unsubscribeProds();
      unsubscribeCats();
      unsubscribeSettings();
    };
  }, [ownerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      if (editingProduct) {
        const oldStock = editingProduct.stock || 0;
        const newStock = parseInt(formData.stock.toString()) || 0;

        // Recalculate existing supplies of this product
        const suppliesRef = collection(db, 'supplies');
        const q = query(suppliesRef, where('ownerId', '==', ownerId), where('productId', '==', editingProduct.id));
        const querySnapshot = await getDocs(q);

        for (const d of querySnapshot.docs) {
          const supplyData = d.data();
          const pName = formData.name;
          const bPrice = formData.buyPrice;
          const qty = supplyData.quantity || 0;
          const tCost = qty * bPrice;

          await updateDoc(doc(db, 'supplies', d.id), {
            productName: pName,
            buyPrice: bPrice,
            totalCost: tCost,
            ownerId,
            userId: userProfile?.uid || ownerId
          });
        }

        // Add supply adjustment record if stock increased
        if (newStock > oldStock) {
          const qtyAdded = newStock - oldStock;
          const expenseAmount = qtyAdded * formData.buyPrice;
          await addDoc(collection(db, 'supplies'), {
            productId: editingProduct.id,
            productName: formData.name,
            quantity: qtyAdded,
            buyPrice: formData.buyPrice,
            totalCost: expenseAmount,
            date: new Date(),
            ownerId,
            userId: userProfile?.uid || ownerId
          });
          console.log(`[DEBUG LOG] Produit "Modifié" (Stock Augmenté) de ${editingProduct.name}:`, {
            productId: editingProduct.id,
            productName: formData.name,
            quantity: qtyAdded,
            buyPrice: formData.buyPrice,
            calculatedExpense: expenseAmount
          });
        } else if (newStock < oldStock) {
          // Add negative supply adjustment record if stock decreased
          const qtyRemoved = oldStock - newStock;
          const expenseAmount = -qtyRemoved * formData.buyPrice;
          await addDoc(collection(db, 'supplies'), {
            productId: editingProduct.id,
            productName: formData.name,
            quantity: -qtyRemoved,
            buyPrice: formData.buyPrice,
            totalCost: expenseAmount,
            date: new Date(),
            ownerId,
            userId: userProfile?.uid || ownerId
          });
          console.log(`[DEBUG LOG] Produit "Modifié" (Stock Diminué) de ${editingProduct.name}:`, {
            productId: editingProduct.id,
            productName: formData.name,
            quantity: -qtyRemoved,
            buyPrice: formData.buyPrice,
            calculatedExpense: expenseAmount
          });
        } else {
          console.log(`[DEBUG LOG] Produit "Modifié" (Stock inchangé) de ${editingProduct.name}:`, {
            productId: editingProduct.id,
            productName: formData.name,
            buyPrice: formData.buyPrice
          });
        }

        await updateDoc(doc(db, 'products', editingProduct.id), {
          ...formData,
          ownerId,
          userId: userProfile?.uid || ownerId
        });
      } else {
        const docRef = await addDoc(collection(db, 'products'), {
          ...formData,
          createdAt: new Date().toISOString(),
          ownerId,
          userId: userProfile?.uid || ownerId
        });
        const stockInt = parseInt(formData.stock.toString()) || 0;
        if (stockInt > 0) {
          const expenseAmount = stockInt * formData.buyPrice;
          await addDoc(collection(db, 'supplies'), {
            productId: docRef.id,
            productName: formData.name,
            quantity: stockInt,
            buyPrice: formData.buyPrice,
            totalCost: expenseAmount,
            date: new Date(),
            ownerId,
            userId: userProfile?.uid || ownerId
          });
          console.log(`[DEBUG LOG] Produit "Créé":`, {
            productId: docRef.id,
            productName: formData.name,
            quantity: stockInt,
            buyPrice: formData.buyPrice,
            calculatedExpense: expenseAmount
          });
        } else {
          console.log(`[DEBUG LOG] Produit "Créé" sans stock initial:`, {
            productId: docRef.id,
            productName: formData.name
          });
        }
      }
      closeModal();
    } catch (error: any) {
      console.error("[ERROR] Failed to save product:", error);
      setErrorMsg(error?.message || String(error));
    }
  };

  const handleReplenishSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replenishProduct || !replenishQty) return;
    try {
      const qty = parseInt(replenishQty) || 0;
      const price = parseFloat(replenishPrice) || 0;
      if (qty <= 0) return;

      const newStock = (replenishProduct.stock || 0) + qty;
      const expenseAmount = qty * price;
      
      // Update product stock and buy price (works locally offline via Firestore cache)
      await updateDoc(doc(db, 'products', replenishProduct.id), {
        stock: newStock,
        buyPrice: price,
        ownerId,
        userId: userProfile?.uid || ownerId
      });

      // Log supply entry
      await addDoc(collection(db, 'supplies'), {
        productId: replenishProduct.id,
        productName: replenishProduct.name,
        quantity: qty,
        buyPrice: price,
        totalCost: expenseAmount,
        date: new Date(),
        ownerId,
        userId: userProfile?.uid || ownerId
      });

      // Track in custom offline queue if offline to count pending operations
      if (!navigator.onLine) {
        addPendingOperation('REPLENISH_STOCK', {
          productId: replenishProduct.id,
          qty,
          price,
          expenseAmount,
          productName: replenishProduct.name
        });
      }

      console.log(`[DEBUG LOG] Approvisionnement effectué pour "${replenishProduct.name}":`, {
        productId: replenishProduct.id,
        productName: replenishProduct.name,
        quantity: qty,
        buyPrice: price,
        calculatedExpense: expenseAmount
      });

      setReplenishProduct(null);
      setReplenishQty('');
      setReplenishPrice('');
      playBeep('success');
    } catch (error: any) {
      console.error("[ERROR] Failed to replenish product stock:", error);
      playBeep('error');
    }
  };

  const executeProductDelete = async () => {
    if (!productToDelete) return;
    setErrorMsg(null);
    try {
      // Delete associated supplies
      const suppliesRef = collection(db, 'supplies');
      const q = query(suppliesRef, where('ownerId', '==', ownerId), where('productId', '==', productToDelete.id));
      const querySnapshot = await getDocs(q);
      for (const d of querySnapshot.docs) {
        await deleteDoc(doc(db, 'supplies', d.id));
      }

      await deleteDoc(doc(db, 'products', productToDelete.id));
      console.log(`[DEBUG] Produit supprimé: "${productToDelete.name}" (ID: ${productToDelete.id}). Quantité: ${productToDelete.stock}, Prix d'achat: ${productToDelete.buyPrice}. Toutes les dépenses correspondantes ont été supprimées.`);
      setProductToDelete(null);
    } catch (error: any) {
      console.error("[ERROR] Failed to delete product:", error);
      setErrorMsg(error?.message || String(error));
    }
  };

  const executeCategoryDelete = async (categoryId: string, categoryName: string) => {
    try {
      await deleteDoc(doc(db, 'categories', categoryId));
      if (formData.category === categoryName) {
        const remaining = categories.filter(c => c.id !== categoryId);
        setFormData(prev => ({ ...prev, category: remaining[0]?.name || '' }));
      }
      setDeletingCatId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'categories');
    }
  };

  const openModal = (product?: Product) => {
    setErrorMsg(null);
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        category: product.category,
        buyPrice: product.buyPrice,
        sellPrice: product.sellPrice,
        barcode: product.barcode || '',
        stock: product.stock,
        expirationDate: product.expirationDate || '',
        lowStockAlert: product.lowStockAlert || 5
      });
      setBuyPriceInput(product.buyPrice.toFixed(3));
      setSellPriceInput(product.sellPrice.toFixed(3));
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        category: categories[0]?.name || 'produit',
        buyPrice: 0,
        sellPrice: 0,
        barcode: '',
        stock: 0,
        expirationDate: '',
        lowStockAlert: 5
      });
      setBuyPriceInput('');
      setSellPriceInput('');
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setErrorMsg(null);
  };

  const handleQuickCategoryAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    
    const exists = categories.some(c => c.name.toLowerCase() === newCategoryName.trim().toLowerCase());
    if (exists) {
      alert('Cette catégorie existe déjà.');
      return;
    }
    
    try {
      await addDoc(collection(db, 'categories'), {
        name: newCategoryName.trim(),
        type: 'autre',
        ownerId
      });
      setFormData(prev => ({ ...prev, category: newCategoryName.trim() }));
      setNewCategoryName('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'categories');
    }
  };

  const handleResetDefaultCategories = async () => {
    if (!confirm('Voulez-vous restaurer les catégories de base par défaut ?')) return;
    const defaults = [
      { id: 'cat_alimentation', name: 'Alimentation' },
      { id: 'cat_boissons', name: 'Boissons' },
      { id: 'cat_entretien', name: 'Entretien' },
      { id: 'cat_produits_frais', name: 'Produits Frais' }
    ];
    for (const cat of defaults) {
      try {
        await setDoc(doc(db, 'categories', cat.id + '_' + ownerId), {
          name: cat.name,
          type: 'autre',
          ownerId
        });
      } catch (err) {
        console.error('Error seeding category:', cat.name, err);
      }
    }
  };



  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Produits</h1>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Gérez votre inventaire de produits et articles de supérette</p>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={() => openModal()}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-300 shadow-lg shadow-indigo-600/15 group hover:-translate-y-0.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 transition-transform group-hover:rotate-90 duration-300" />
            Nouveau Produit
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden premium-shadow">
        <div className="p-5 border-b border-slate-100 bg-slate-50/20">
          <div className="relative max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher un produit..."
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
                <th className="px-6 py-4">Produit</th>
                <th className="px-6 py-4">Catégorie</th>
                <th className="px-6 py-4">Prix Achat</th>
                <th className="px-6 py-4">Prix Vente</th>
                <th className="px-6 py-4">Stock</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/70">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-500">Chargement...</td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-500">Aucun produit trouvé.</td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{product.name}</div>
                      <div className="flex flex-col gap-0.5">
                        {product.barcode && (
                          <div className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded w-fit">
                            Ref: {product.barcode}
                          </div>
                        )}
                        {product.expirationDate && (
                          <div className="text-xs text-gray-500">Exp: {product.expirationDate}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
                        (() => {
                           const cat = categories.find(c => c.name === product.category);
                           if (!cat) return "bg-indigo-50 text-indigo-700";
                           return cat.type === 'boissons' ? "bg-blue-50 text-blue-700" :
                                  cat.type === 'entretien' ? "bg-orange-50 text-orange-700" :
                                  cat.type === 'frais' ? "bg-purple-50 text-purple-700" :
                                  "bg-indigo-50 text-indigo-700";
                        })()
                      )}>
                        {product.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600 font-mono">{product.buyPrice.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                    <td className="px-6 py-4 text-gray-900 font-bold font-mono">{product.sellPrice.toFixed(3)} {storeSettings?.currency || 'DT'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "font-medium",
                          product.stock <= (product.lowStockAlert || 5) ? "text-red-600" : "text-gray-900"
                        )}>
                          {product.stock}
                        </span>
                        {product.stock <= (product.lowStockAlert || 5) && (
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setReplenishProduct(product);
                            setReplenishQty('');
                            setReplenishPrice(product.buyPrice.toFixed(3));
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-all text-xs font-black uppercase tracking-wider cursor-pointer border border-emerald-150"
                          title="Approvisionner (ajouter du stock) pour ce produit"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>+ Stock</span>
                        </button>

                        <button
                          onClick={() => openModal(product)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setProductToDelete(product)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent"
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[calc(100vh-24px)] sm:max-h-[85vh] overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-150">
            <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-900">
                {editingProduct ? 'Modifier Produit' : 'Nouveau Produit'}
              </h2>
              <button onClick={closeModal} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4 touch-pan-y">
                {errorMsg && (
                  <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-700 text-xs font-medium animate-in fade-in duration-150">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span className="break-all">{errorMsg}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nom du produit</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>

                  <div className="col-span-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-black uppercase tracking-wider text-slate-700">
                        Code à barre / Référence
                      </label>
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Scanner Douchette Prêt
                      </span>
                    </div>
                    
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                        <Barcode className="h-4.5 w-4.5 text-indigo-500 group-focus-within:text-indigo-600" />
                      </div>
                      <input
                        type="text"
                        placeholder="Pointez votre douchette et flashez, ou tapez ici..."
                        value={formData.barcode}
                        onChange={(e) => setFormData({ ...formData, barcode: decodeAzertyBarcode(e.target.value) })}
                        className="w-full pl-11 pr-24 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-xs font-bold font-mono text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all duration-300"
                      />
                      <div className="absolute inset-y-1.5 right-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const randomCode = '619' + Math.floor(1000000000 + Math.random() * 9000000000).toString();
                            setFormData({ ...formData, barcode: randomCode });
                            playBeep('success');
                          }}
                          className="h-full px-2.5 bg-slate-100 hover:bg-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 rounded-lg transition-colors border border-slate-200 cursor-pointer"
                          title="Générer un code-barres aléatoire commençant par 619 Tunisie"
                        >
                          Générer
                        </button>
                      </div>
                    </div>

                    {scanStatus === 'scanned' && (
                      <div className="text-[11px] font-black text-emerald-600 bg-emerald-50/80 px-3 py-1.5 rounded-xl border border-emerald-100 flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-300">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        <span>{scanMessage}</span>
                      </div>
                    )}
                    
                    <p className="text-[10px] text-slate-500 font-sans leading-relaxed">
                      Vous pouvez scanner directement le produit à tout moment pendant que ce formulaire est ouvert. La douchette remplira automatiquement ce champ et émettra un signal sonore.
                    </p>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                    <div className="flex gap-2">
                      <select
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-slate-800 bg-white"
                        required
                      >
                        {categories.length === 0 ? (
                          <option value="">⚠️ Veuillez créer une catégorie</option>
                        ) : (
                          <>
                            <option value="">-- Choisir une catégorie --</option>
                            {categories.map(cat => (
                              <option key={cat.id} value={cat.name}>{cat.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => setIsQuickCategoryModalOpen(true)}
                        className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors cursor-pointer"
                        title="Ajouter une catégorie"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stock Initial</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={formData.stock}
                      onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Alerte Stock Faible</label>
                    <input
                      type="number"
                      min="0"
                      value={formData.lowStockAlert}
                      onChange={(e) => setFormData({ ...formData, lowStockAlert: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prix Achat ({storeSettings?.currency || 'DT'})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={buyPriceInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setBuyPriceInput(value);
                          const parsed = parseFloat(value) || 0;
                          setFormData({ ...formData, buyPrice: Math.round(parsed * 1000) / 1000 });
                        }
                      }}
                      onBlur={() => {
                        const parsed = parseFloat(buyPriceInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setBuyPriceInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setFormData({ ...formData, buyPrice: rounded });
                      }}
                      placeholder="0.00"
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prix Vente ({storeSettings?.currency || 'DT'})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={sellPriceInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(',', '.');
                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                          setSellPriceInput(value);
                          const parsed = parseFloat(value) || 0;
                          setFormData({ ...formData, sellPrice: Math.round(parsed * 1000) / 1000 });
                        }
                      }}
                      onBlur={() => {
                        const parsed = parseFloat(sellPriceInput) || 0;
                        const rounded = Math.round(parsed * 1000) / 1000;
                        setSellPriceInput(rounded === 0 ? '' : rounded.toFixed(3));
                        setFormData({ ...formData, sellPrice: rounded });
                      }}
                      placeholder="0.00"
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date Expiration</label>
                    <input
                      type="date"
                      value={formData.expirationDate}
                      onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none box-border"
                    />
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-gray-100 p-4 bg-gray-50/70 flex gap-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2.5 bg-gray-150 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors cursor-pointer text-sm"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/15 cursor-pointer text-sm"
                >
                  {editingProduct ? 'Enregistrer' : 'Ajouter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Quick Category Modal */}
      {isQuickCategoryModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="text-base font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                <Tag className="w-4 h-4 text-indigo-500 animate-pulse" />
                Gérer les Catégories
              </h2>
              <button onClick={() => setIsQuickCategoryModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-5">
              {/* Add form */}
              <form onSubmit={handleQuickCategoryAdd} className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-600">Nouveau nom de catégorie</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    required
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="flex-1 px-3.5 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-xs font-semibold placeholder:text-slate-400 bg-slate-50 focus:bg-white transition-all text-slate-900"
                    placeholder="Ex: Boissons, Fruits..."
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-indigo-600/10 cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Ajouter
                  </button>
                </div>
              </form>

              {/* List of existing categories */}
              <div className="space-y-2.5">
                <span className="block text-xs font-black uppercase tracking-wider text-slate-600 border-b border-slate-100 pb-1.5 mb-1">
                  Catégories existantes ({categories.length})
                </span>
                
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {categories.length === 0 ? (
                    <p className="text-center py-6 text-slate-400 text-xs font-medium">Aucune catégorie enregistrée.</p>
                  ) : (
                    categories.map((cat) => (
                      <div key={cat.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-100 rounded-xl transition-all group">
                        {deletingCatId === cat.id ? (
                          <div className="flex items-center justify-between w-full animate-in fade-in slide-in-from-right-1 duration-150">
                            <span className="text-[11px] font-black text-red-600 uppercase tracking-wider flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                              Supprimer?
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setDeletingCatId(null)}
                                className="px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-slate-200 rounded-lg transition-colors cursor-pointer"
                              >
                                Non
                              </button>
                              <button
                                type="button"
                                onClick={() => executeCategoryDelete(cat.id, cat.name)}
                                className="px-2.5 py-1 text-[10px] font-black text-white bg-red-600 hover:bg-red-700 rounded-lg transition-all cursor-pointer"
                              >
                                Oui
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
                              <Tag className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                              {cat.name}
                            </span>
                            
                            <button
                              type="button"
                              onClick={() => setDeletingCatId(cat.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              title={`Supprimer la catégorie ${cat.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-50 bg-slate-50/50 flex justify-between items-center">
              <button
                type="button"
                onClick={handleResetDefaultCategories}
                className="text-slate-500 hover:text-indigo-600 text-[10px] font-black uppercase tracking-wider underline cursor-pointer"
                title="Restaurer les catégories de base par défaut"
              >
                Réinit. défauts
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeletingCatId(null);
                  setIsQuickCategoryModalOpen(false);
                }}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-black uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Delete Confirmation Modal */}
      {productToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-50 text-red-600 rounded-xl">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Supprimer le produit ?</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Êtes-vous sûr de vouloir supprimer définitivement le produit <strong className="text-slate-800">"{productToDelete.name}"</strong> ? Cette action est irréversible.
                </p>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-700 text-xs font-medium animate-in fade-in duration-150">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="break-all">{errorMsg}</span>
              </div>
            )}
            
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setProductToDelete(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={executeProductDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors shadow-md shadow-red-600/10 cursor-pointer"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replenish Stock Modal */}
      {replenishProduct && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[calc(100vh-24px)] sm:max-h-[85vh] overflow-hidden border border-slate-100">
            <div className="flex-shrink-0 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                Approvisionner : {replenishProduct.name}
              </h3>
              <button 
                onClick={() => setReplenishProduct(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleReplenishSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-4 touch-pan-y">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-600 mb-1">
                    Quantité à ajouter au stock
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="Ex: 50"
                    value={replenishQty}
                    onChange={(e) => setReplenishQty(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-indigo-500 outline-none text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-600 mb-1">
                    Prix d'achat unitaire ({storeSettings?.currency || 'DT'})
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    min="0.001"
                    placeholder="Ex: 2.500"
                    value={replenishPrice}
                    onChange={(e) => setReplenishPrice(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-indigo-500 outline-none text-xs font-bold font-mono"
                  />
                </div>

                {replenishQty && replenishPrice && (
                  <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-xl space-y-1 my-2">
                    <div className="flex justify-between text-xs text-slate-500 font-medium">
                      <span>Quantité :</span>
                      <span className="font-bold text-slate-700">{replenishQty}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500 font-medium">
                      <span>Prix unitaire :</span>
                      <span className="font-bold text-slate-700">{parseFloat(replenishPrice).toFixed(3)} {storeSettings?.currency || 'DT'}</span>
                    </div>
                    <div className="border-t border-slate-200/50 my-1.5 pt-1.5 flex justify-between text-xs font-bold text-slate-800">
                      <span>Dépense totale estimée :</span>
                      <span className="text-emerald-700 font-black">
                        {(parseInt(replenishQty) * parseFloat(replenishPrice)).toFixed(3)} {storeSettings?.currency || 'DT'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 border-t border-slate-100 p-4 bg-slate-50/70 flex gap-3 justify-end pb-[calc(1rem+env(safe-area-inset-bottom,0px))] animate-in fade-in duration-200">
                <button
                  type="button"
                  onClick={() => setReplenishProduct(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-650 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-emerald-600/10 cursor-pointer active:scale-[0.98]"
                >
                  Confirmer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
