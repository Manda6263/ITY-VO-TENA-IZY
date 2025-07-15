import { useState, useEffect, useCallback } from 'react';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  query, 
  orderBy, 
  writeBatch,
  getDoc,
  setDoc,
  where
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { RegisterSale, Product, Alert, DashboardStats } from '../types';
import { format, parseISO } from 'date-fns';

export function useFirebaseData() {
  const [registerSales, setRegisterSales] = useState<RegisterSale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    totalSales: 0,
    totalRevenue: 0,
    totalProducts: 0,
    lowStockProducts: 0,
    topProducts: [],
    recentSales: []
  });
  const [loading, setLoading] = useState(true);

  // Load initial data
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [salesData, productsData] = await Promise.all([
        loadRegisterSales(),
        loadProducts(),
        loadAlerts()
      ]);
      
      // Calculate dashboard stats after loading data
      const stats = calculateDashboardStats(salesData, productsData);
      setDashboardStats(stats);
      
      // Update products with sales data for consistency
      updateProductsWithSalesData(productsData, salesData);
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load alerts from Firestore
  const loadAlerts = async () => {
    try {
      const alertsQuery = query(
        collection(db, 'alerts'),
        orderBy('createdAt', 'desc')
      );
      const alertsSnapshot = await getDocs(alertsQuery);
      const alertsData = alertsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date()
      })) as Alert[];
      
      setAlerts(alertsData);
      return alertsData;
    } catch (error) {
      console.error('Error loading alerts:', error);
      // Return empty array if alerts collection doesn't exist yet
      setAlerts([]);
      return [];
    }
  };

  // Calculate dashboard statistics
  const calculateDashboardStats = useCallback((salesData: RegisterSale[], productsData: Product[]): DashboardStats => {
    // Calculate total quantity sold
    const totalSales = salesData.length;
    
    // Calculate total revenue (using sale.total which is the actual revenue)
    const totalRevenue = salesData.reduce((sum, sale) => sum + sale.total, 0);
    
    // Count low stock products
    const lowStockProducts = productsData.filter(product => 
      product.stock <= product.minStock && product.isConfigured
    ).length;

    // Calculate top products by quantity sold
    const productSales = new Map<string, { name: string, quantity: number, revenue: number }>();
    salesData.forEach(sale => {
      const key = sale.product;
      if (productSales.has(key)) {
        const existing = productSales.get(key)!;
        existing.quantity += sale.quantity;
        existing.revenue += sale.total; // Use total directly for accurate revenue
      } else {
        productSales.set(key, {
          name: sale.product,
          quantity: sale.quantity,
          revenue: sale.total
        });
      }
    });

    const topProducts = Array.from(productSales.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // Get recent sales (last 10)
    const recentSales = salesData.slice(0, 10);

    // Return the calculated stats instead of setting state directly
    return {
      totalSales,
      totalRevenue,
      totalProducts: productsData.length,
      lowStockProducts,
      topProducts,
      recentSales
    };
  }, []);

  // Update products with sales data for consistency
  const updateProductsWithSalesData = useCallback((productsData: Product[], salesData: RegisterSale[]) => {
    // Create a map to track sales by product
    const productSalesMap = new Map<string, {
      quantitySold: number;
      lastSale: Date | null;
      revenue: number;
    }>();
    
    // Process all sales to calculate per-product metrics
    salesData.forEach(sale => {
      const key = `${sale.product}-${sale.category}`;
      
      if (!productSalesMap.has(key)) {
        productSalesMap.set(key, {
          quantitySold: 0,
          lastSale: null,
          revenue: 0
        });
      }
      
      const productStats = productSalesMap.get(key)!;
      productStats.quantitySold += sale.quantity;
      productStats.revenue += sale.total;
      
      // Update last sale date if this sale is more recent
      if (!productStats.lastSale || sale.date > productStats.lastSale) {
        productStats.lastSale = sale.date;
      }
    });
    
    // Update products with the calculated sales data
    const updatedProducts = productsData.map(product => {
      const key = `${product.name}-${product.category}`;
      const salesStats = productSalesMap.get(key);
      
      if (salesStats) {
        // Calculate stock based on initial stock and sales
        const initialStock = product.initialStock || 0;
        const quantitySold = salesStats.quantitySold;
        const stock = Math.max(0, initialStock - quantitySold);
        
        return {
          ...product,
          quantitySold,
          stock,
          lastSale: salesStats.lastSale,
          stockValue: stock * product.price
        };
      }
      
      return product;
    });
    
    setProducts(updatedProducts);
  }, []);

  // Load register sales from Firestore
  const loadRegisterSales = async () => {
    try {
      const salesQuery = query(
        collection(db, 'register_sales'),
        orderBy('date', 'desc')
      );
      const salesSnapshot = await getDocs(salesQuery);
      
      // Process sales data with proper date conversion
      const salesData = salesSnapshot.docs.map(doc => {
        const data = doc.data();
        let date: Date;
        
        // Handle different date formats
        if (data.date) {
          if (typeof data.date === 'string') {
            // If it's a string (ISO format or similar)
            date = new Date(data.date);
          } else if (data.date.toDate && typeof data.date.toDate === 'function') {
            // If it's a Firestore Timestamp
            date = data.date.toDate();
          } else {
            // Fallback
            date = new Date();
          }
        } else {
          date = new Date();
        }
        
        return {
          id: doc.id,
          ...data,
          date,
          // Ensure total is calculated correctly if not present
          total: data.total || (data.price * data.quantity)
        } as RegisterSale;
      });
      
      setRegisterSales(salesData);
      return salesData;
    } catch (error) {
      console.error('Error loading register sales:', error);
      return [];
    }
  };

  // Load products from Firestore
  const loadProducts = async () => {
    try {
      const productsQuery = query(
        collection(db, 'products'),
        orderBy('name', 'asc')
      );
      const productsSnapshot = await getDocs(productsQuery);
      const productsData = productsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        lastSale: doc.data().lastSale?.toDate() || null,
        initialStockDate: doc.data().initialStockDate || format(new Date(), 'yyyy-MM-dd')
      })) as Product[];
      
      setProducts(productsData);
      return productsData;
    } catch (error) {
      console.error('Error loading products:', error);
      return [];
    }
  };

  // Extract products from sales data
  const extractProductsFromSales = useCallback((sales: RegisterSale[]) => {
    const productMap = new Map<string, Product>();
    const productSales = new Map<string, {
      quantitySold: number;
      lastSale: Date | null;
      revenue: number;
    }>();
    
    sales.forEach(sale => {
      const key = `${sale.product}-${sale.category}`;
      
      // Track sales data per product
      if (!productSales.has(key)) {
        productSales.set(key, {
          quantitySold: 0,
          lastSale: null,
          revenue: 0
        });
      }
      
      const productStats = productSales.get(key)!;
      productStats.quantitySold += sale.quantity;
      productStats.revenue += sale.total;
      
      // Update last sale date if this sale is more recent
      if (!productStats.lastSale || sale.date > productStats.lastSale) {
        productStats.lastSale = sale.date;
      }
      
      if (productMap.has(key)) {
        const existing = productMap.get(key)!;
        existing.quantitySold = (existing.quantitySold || 0) + sale.quantity;
        
        // Calculate weighted average price
        const totalValue = existing.price * (existing.quantitySold - sale.quantity) + sale.price * sale.quantity;
        existing.price = totalValue / existing.quantitySold;
        
        // Update last sale date if more recent
        if (sale.date > (existing.lastSale || new Date(0))) {
          existing.lastSale = sale.date;
        }
      } else {
        // Create a new product entry
        const newProduct: Product = {
          id: `${sale.product}-${sale.category}`.replace(/[^a-zA-Z0-9]/g, '-'),
          name: sale.product,
          category: sale.category,
          price: sale.price,
          quantitySold: 0, // Will be updated later
          initialStock: 0, // Will be updated later
          stock: 0, // Will be calculated later
          minStock: 5,
          stockValue: 0, // Will be calculated later
          lastSale: null, // Will be updated later
          isConfigured: false,
          initialStockDate: format(new Date(), 'yyyy-MM-dd')
        };
        productMap.set(key, newProduct);
      }
    });
    
    // Update stock values based on total sold
    const products = Array.from(productMap.values());
    
    // Update products with sales data
    return products.map(product => {
      const key = `${product.name}-${product.category}`;
      const stats = productSales.get(key);
      
      if (stats) {
        const estimatedInitialStock = Math.max(10, Math.ceil(stats.quantitySold * 1.5));
        
        return {
          ...product,
          quantitySold: stats.quantitySold,
          initialStock: product.isConfigured ? product.initialStock : estimatedInitialStock,
          stock: product.isConfigured 
            ? Math.max(0, product.initialStock - stats.quantitySold)
            : Math.max(0, estimatedInitialStock - stats.quantitySold),
          lastSale: stats.lastSale,
          stockValue: product.isConfigured
            ? Math.max(0, product.initialStock - stats.quantitySold) * product.price
            : Math.max(0, estimatedInitialStock - stats.quantitySold) * product.price
        };
      }
      
      return product;
    });
  }, []);

  // Add register sales
  const addRegisterSales = async (sales: Omit<RegisterSale, 'id'>[]) => {
    try {
      const batch = writeBatch(db);
      
      sales.forEach(sale => {
        const docRef = doc(collection(db, 'register_sales'));
        batch.set(docRef, {
          ...sale,
          date: sale.date instanceof Date ? sale.date : new Date(sale.date)
        });
      });
      
      await batch.commit();
      await loadInitialData();
    } catch (error) {
      console.error('Error adding register sales:', error);
      throw error;
    }
  };

  // Add single register sale
  const addRegisterSale = async (sale: Omit<RegisterSale, 'id'>) => {
    try {
      await addDoc(collection(db, 'register_sales'), {
        ...sale,
        date: sale.date instanceof Date ? sale.date : new Date(sale.date)
      });
      await loadInitialData();
    } catch (error) {
      console.error('Error adding register sale:', error);
      throw error;
    }
  };

  // Update register sale
  const updateRegisterSale = async (id: string, updates: Partial<RegisterSale>) => {
    try {
      const saleRef = doc(db, 'register_sales', id);
      await updateDoc(saleRef, {
        ...updates,
        date: updates.date instanceof Date ? updates.date : new Date(updates.date || Date.now())
      });
      await loadInitialData();
    } catch (error) {
      console.error('Error updating register sale:', error);
      throw error;
    }
  };

  // Delete register sale
  const deleteRegisterSale = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'register_sales', id));
      await loadInitialData();
    } catch (error) {
      console.error('Error deleting register sale:', error);
      throw error;
    }
  };

  // Delete multiple register sales
  const deleteRegisterSales = async (ids: string[]) => {
    try {
      const batch = writeBatch(db);
      ids.forEach(id => {
        batch.delete(doc(db, 'register_sales', id));
      });
      await batch.commit();
      await loadInitialData();
    } catch (error) {
      console.error('Error deleting register sales:', error);
      throw error;
    }
  };

  // Add product
  const addProduct = async (product: Omit<Product, 'id'>) => {
    try {
      await addDoc(collection(db, 'products'), product);
      await loadProducts();
    } catch (error) {
      console.error('Error adding product:', error);
      throw error;
    }
  };

  // Add multiple products
  const addProducts = async (products: Omit<Product, 'id'>[]) => {
    try {
      const batch = writeBatch(db);
      products.forEach(product => {
        const docRef = doc(collection(db, 'products'));
        batch.set(docRef, product);
      });
      await batch.commit();
      await loadProducts();
    } catch (error) {
      console.error('Error adding products:', error);
      throw error;
    }
  };

  // Update product
  const updateProduct = async (id: string, updates: Partial<Product>) => {
    try {
      const productRef = doc(db, 'products', id);
      await updateDoc(productRef, updates);
      await loadProducts();
    } catch (error) {
      console.error('Error updating product:', error);
      throw error;
    }
  };

  // Delete product
  const deleteProduct = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'products', id));
      await loadProducts();
    } catch (error) {
      console.error('Error deleting product:', error);
      throw error;
    }
  };

  // Delete multiple products
  const deleteProducts = async (ids: string[]) => {
    try {
      const batch = writeBatch(db);
      ids.forEach(id => {
        batch.delete(doc(db, 'products', id));
      });
      await batch.commit();
      await loadProducts();
    } catch (error) {
      console.error('Error deleting products:', error);
      throw error;
    }
  };

  // Auto sync products from sales
  const autoSyncProductsFromSales = async (): Promise<boolean> => {
    try {
      const sales = await loadRegisterSales();
      
      // Get existing products first
      const existingProducts = await loadProducts();
      const existingProductMap = new Map<string, Product>();
      existingProducts.forEach(product => {
        const key = `${product.name}-${product.category}`;
        existingProductMap.set(key, product);
      });
      
      // Extract products from sales
      const extractedProducts = extractProductsFromSales(sales);
      
      // Prepare batch update
      const batch = writeBatch(db);
      
      // Process each extracted product
      extractedProducts.forEach(extractedProduct => {
        const key = `${extractedProduct.name}-${extractedProduct.category}`;
        const existingProduct = existingProductMap.get(key);
        
        // If product exists, update only sales-related fields
        if (existingProduct) {
          const docRef = doc(db, 'products', existingProduct.id);
          
          // Preserve existing configuration
          const updates = {
            quantitySold: extractedProduct.quantitySold,
            lastSale: extractedProduct.lastSale,
            // Only update stock if not manually configured
            ...(!existingProduct.isConfigured ? {
              stock: extractedProduct.stock,
              stockValue: extractedProduct.stockValue
            } : {})
          };
          
          batch.update(docRef, updates);
        } else {
          // Create new product
          const docRef = doc(collection(db, 'products'));
          batch.set(docRef, {
            ...extractedProduct,
            id: docRef.id // Use Firestore generated ID
          });
        }
      });
      
      // Commit all changes
      await batch.commit();
      await loadProducts();
      
      // Recalculate dashboard stats
      const updatedSales = await loadRegisterSales();
      const updatedProducts = await loadProducts();
      const stats = calculateDashboardStats(updatedSales, updatedProducts);
      setDashboardStats(stats);
      
      return true;
    } catch (error) {
      console.error('Error syncing products from sales:', error);
      return false;
    }
  };

  // Update stock configuration
  const updateStockConfig = async (productId: string, config: { initialStock: number, initialStockDate: string, minStock: number }) => {
    try {
      // Get the product document
      const productRef = doc(db, 'products', productId);
      const productDoc = await getDoc(productRef);
      
      if (productDoc.exists()) {
        const productData = productDoc.data() as Product;
        
        // Get all sales for this product to calculate accurate stock
        const salesQuery = query(
          collection(db, 'register_sales'),
          where('product', '==', productData.name),
          where('category', '==', productData.category)
        );
        const salesSnapshot = await getDocs(salesQuery);
        
        // Calculate total quantity sold
        let quantitySold = 0;
        salesSnapshot.docs.forEach(doc => {
          const saleData = doc.data();
          quantitySold += saleData.quantity || 0;
        });
        
        // Calculate current stock based on initial stock and sales
        const stock = Math.max(0, config.initialStock - quantitySold);
        
        // Update product with new configuration
        const updatedProduct = {
          ...productData,
          initialStock: config.initialStock,
          initialStockDate: config.initialStockDate,
          minStock: config.minStock,
          quantitySold,
          stock,
          stockValue: stock * productData.price,
          isConfigured: true
        };
        
        await setDoc(productRef, updatedProduct);
        await loadProducts();
      }
    } catch (error) {
      console.error('Error updating stock config:', error);
      throw error;
    }
  };

  // Mark alert as read
  const markAlertAsRead = async (alertId: string) => {
    try {
      const alertRef = doc(db, 'alerts', alertId);
      await updateDoc(alertRef, { read: true });
      await loadAlerts();
    } catch (error) {
      console.error('Error marking alert as read:', error);
      throw error;
    }
  };

  // Update sale (alias for updateRegisterSale)
  const updateSale = updateRegisterSale;

  // Delete sales (alias for deleteRegisterSales)
  const deleteSales = deleteRegisterSales;

  // Categorize sales (placeholder function)
  const categorizeSales = async (saleIds: string[], category: string) => {
    try {
      const batch = writeBatch(db);
      saleIds.forEach(id => {
        const saleRef = doc(db, 'register_sales', id);
        batch.update(saleRef, { category });
      });
      await batch.commit();
      await loadInitialData();
    } catch (error) {
      console.error('Error categorizing sales:', error);
      throw error;
    }
  };

  // Refresh data
  const refreshData = useCallback(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Load data on mount
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  return {
    registerSales,
    products,
    dashboardStats,
    alerts,
    loading,
    addRegisterSales,
    addRegisterSale,
    updateRegisterSale,
    updateSale,
    deleteRegisterSale,
    deleteRegisterSales,
    deleteSales,
    categorizeSales,
    addProduct,
    addProducts,
    updateProduct,
    deleteProduct,
    deleteProducts,
    markAlertAsRead,
    refreshData,
    autoSyncProductsFromSales,
    updateStockConfig,
    categorizeSales
  };
}