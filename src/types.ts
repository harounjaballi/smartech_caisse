export interface Category {
  id: string;
  name: string;
  type: 'alimentation' | 'boissons' | 'entretien' | 'frais' | 'autre'; // For styling grocery departments
  ownerId?: string;
}

export interface Product {
  id: string;
  name: string;
  category: string; // Will store category ID or name
  buyPrice: number;
  sellPrice: number;
  barcode?: string;
  stock: number;
  expirationDate?: string;
  lowStockAlert?: number;
  ownerId?: string;
  createdAt?: string;
}

export interface Client {
  id: string;
  code?: string;
  name: string;
  phone?: string;
  address?: string;
  debt: number;
  ownerId?: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface Sale {
  id: string;
  date: any; // Firestore Timestamp
  clientId?: string;
  clientName?: string;
  total: number;
  paid: number;
  debt: number;
  tva: number;
  discount?: number;
  invoiceId?: string;
  items: SaleItem[];
  ownerId?: string;
}

export interface Invoice {
  id: string;
  number: string;
  saleId: string;
  clientId?: string;
  clientCode?: string;
  clientName: string;
  clientPhone?: string;
  clientAddress?: string;
  total: number;
  paid: number;
  debt: number;
  tva: number;
  discount?: number;
  date: any;
  items: SaleItem[];
  ownerId?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  name?: string;
  role: 'admin' | 'user';
  status?: 'active' | 'banned';
  allowedMenus?: string[];
  password?: string;
  securityCode?: string;
  ownerId?: string;
  creatorId?: string;
}

export interface StoreSettings {
  id: string;
  storeName: string;
  currency: string;
  address?: string;
  phone?: string;
  tva: number;
  tvaEnabled?: boolean;
  ownerId?: string;
  deleteCode?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  date: string; // The associated calendar/reminder date
  createdAt: any; // Timestamp or date
  userId: string;
  ownerId?: string;
}

