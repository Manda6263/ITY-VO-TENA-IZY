import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Package, 
  Search,
  Filter,
  Download,
  ArrowUpDown,
  Calendar,
  AlertTriangle,
  RefreshCw,
  Plus,
  Edit,
  Trash2,
  CheckCircle,
  X,
  Settings,
  TrendingUp,
  TrendingDown,
  Users,
  Monitor,
  CreditCard,
  Eye,
  EyeOff,
  Info,
  Zap,
  AlertCircle
} from 'lucide-react';
import { Product, RegisterSale } from '../types';
import { format, startOfDay, endOfDay, subDays, isAfter, isBefore } from 'date-fns';
import { exportToExcel } from '../utils/excelUtils';
import { ProductEditModal } from './ProductEditModal';
import { useLanguage } from '../contexts/LanguageContext';

interface StockModuleProps {
  products: Product[];
  registerSales: RegisterSale[];
  loading: boolean;
  onAddProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  onAddProducts: (products: Omit<Product, 'id'>[]) => Promise<void>;
  onUpdateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
  onDeleteProducts: (ids: string[]) => Promise<void>;
  onRefreshData: () => void;
  autoSyncProductsFromSales: () => Promise<void>;
  updateStockConfig?: (productId: string, config: { initialStock: number, initialStockDate: string, minStock: number }) => Promise<void>;
  // New props
  stockConfig?: {[productId: string]: { initialStock: number, initialStockDate: string, minStock: number }};
}

interface SmartFilters {
  searchTerm: string;
  dateRange: {
    start: string;
    end: string;
  };
  register: string;
  category: string;
  seller: string;
  stockStatus: 'all' | 'in-stock' | 'low-stock' | 'out-of-stock' | 'not-configured';
  sortField: keyof Product;
  sortDirection: 'asc' | 'desc';
}

export default function StockModule({
  products,
  registerSales,
  loading,
  onAddProduct,
  onAddProducts,
  onUpdateProduct,
  onDeleteProduct,
  onDeleteProducts,
  onRefreshData,
  autoSyncProductsFromSales,
  updateStockConfig,
  stockConfig = {}
}: StockModuleProps) {
  const { t } = useLanguage();
  
  const [filters, setFilters] = useState<SmartFilters>({
    searchTerm: '',
    dateRange: {
      start: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
      end: format(new Date(), 'yyyy-MM-dd')
    },
    register: 'all',
    category: 'all',
    seller: 'all',
    stockStatus: 'all',
    sortField: 'name',
    sortDirection: 'asc'
  });

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    syncing: boolean;
    success?: boolean;
    message?: string;
  }>({ syncing: false });

  // Get unique values for filter dropdowns
  const uniqueRegisters = useMemo(() => 
    [...new Set(registerSales.map(s => s.register))].sort(), 
    [registerSales]
  );
  
  const uniqueCategories = useMemo(() => 
    [...new Set(registerSales.map(s => s.category))].sort(), 
    [registerSales]
  );
  
  const uniqueSellers = useMemo(() => 
    [...new Set(registerSales.map(s => s.seller))].sort(), 
    [registerSales]
  );

  // Filter products based on smart filters
  const filteredProducts = useMemo(() => {
    let filtered = products;
    
    if (filtered.length === 0) {
      return [];
    }

    // Search filter
    if (filters.searchTerm) {
      filtered = filtered.filter(product =>
        product.name.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
        product.category.toLowerCase().includes(filters.searchTerm.toLowerCase())
      );
    }

    // Date range filter (based on last sale date)
    if (filters.dateRange.start || filters.dateRange.end) {
      filtered = filtered.filter(product => {
        if (!product.lastSale) return false;

        const lastSaleDate = product.lastSale;
        let matchesDateRange = true;
        
        if (filters.dateRange.start) {
          const startDate = startOfDay(new Date(filters.dateRange.start));
          matchesDateRange = matchesDateRange && isAfter(lastSaleDate, startDate);
        }
        
        if (filters.dateRange.end) {
          const endDate = endOfDay(new Date(filters.dateRange.end));
          matchesDateRange = matchesDateRange && isBefore(lastSaleDate, endDate);
        }
        
        return matchesDateRange;
      });
    }

    // Register filter
    if (filters.register !== 'all') {
      filtered = filtered.filter(product => {
        const productSales = registerSales.filter(sale => 
          sale.product === product.name && sale.category === product.category
        );
        return productSales.some(sale => sale.register === filters.register);
      });
    }

    // Category filter
    if (filters.category !== 'all') {
      filtered = filtered.filter(product => product.category === filters.category);
    }

    // Seller filter
    if (filters.seller !== 'all') {
      filtered = filtered.filter(product => {
        const productSales = registerSales.filter(sale => 
          sale.product === product.name && sale.category === product.category
        );
        return productSales.some(sale => sale.seller === filters.seller);
      });
    }

    // Stock status filter
    if (filters.stockStatus !== 'all') {
      filtered = filtered.filter(product => {
        switch (filters.stockStatus) {
          case 'in-stock':
            return product.stock > product.minStock;
          case 'low-stock':
            return product.stock > 0 && product.stock <= product.minStock;
          case 'out-of-stock':
            return product.stock === 0;
          case 'not-configured':
            return !product.isConfigured;
          default:
            return true;
        }
      });
    }

    // Sort products
    filtered.sort((a, b) => {
      const aValue = a[filters.sortField];
      const bValue = b[filters.sortField];
      
      let comparison = 0;
      if (aValue < bValue) comparison = -1;
      if (aValue > bValue) comparison = 1;
      
      return filters.sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [products, registerSales, filters]);

  // Calculate statistics
  const statistics = useMemo(() => {
    // Start with filtered products based on search term
    let relevantProducts = products.filter(product =>
      !filters.searchTerm || 
      product.name.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
      product.category.toLowerCase().includes(filters.searchTerm.toLowerCase())
    );
    
    // Filter sales based on current filters
    let filteredSales = registerSales;
    
    // Apply date range filter
    if (filters.dateRange.start || filters.dateRange.end) {
      const start = filters.dateRange.start ? startOfDay(new Date(filters.dateRange.start)) : new Date(0);
      const end = filters.dateRange.end ? endOfDay(new Date(filters.dateRange.end)) : new Date();
      
      filteredSales = filteredSales.filter(sale => 
        isAfter(sale.date, start) && isBefore(sale.date, end)
      );
    }
    
    // Apply register filter
    if (filters.register !== 'all') {
      filteredSales = filteredSales.filter(sale => sale.register === filters.register);
    }
    
    // Apply category filter
    if (filters.category !== 'all') {
      filteredSales = filteredSales.filter(sale => sale.category === filters.category);
    }
    
    // Apply seller filter
    if (filters.seller !== 'all') {
      filteredSales = filteredSales.filter(sale => sale.seller === filters.seller);
    }
    
    // Apply category filter to products directly
    if (filters.category !== 'all') {
      relevantProducts = relevantProducts.filter(product => product.category === filters.category);
    }
    
    // Calculate total revenue from filtered sales
    const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0);
    
    // Filter products based on filtered sales
    const relevantProductNames = new Set(filteredSales.map(sale => `${sale.product}-${sale.category}`));
    
    // If we have register or seller filters, further filter products to only those that appear in filtered sales
    if (filters.register !== 'all' || filters.seller !== 'all') {
      relevantProducts = relevantProducts.filter(product => 
        relevantProductNames.has(`${product.name}-${product.category}`)
      );
    }
    
    // Apply stock status filter
    if (filters.stockStatus !== 'all') {
      relevantProducts = relevantProducts.filter(product => {
        switch (filters.stockStatus) {
          case 'in-stock':
            return product.stock > product.minStock;
          case 'low-stock':
            return product.stock > 0 && product.stock <= product.minStock;
          case 'out-of-stock':
            return product.stock === 0;
          case 'not-configured':
            return !product.isConfigured;
          default:
            return true;
        }
      });
    }
    
    // Calculate statistics based on filtered products
    const configuredProducts = relevantProducts.filter(p => p.isConfigured).length;
    const inStockProducts = relevantProducts.filter(p => p.stock > p.minStock).length;
    const lowStockProducts = relevantProducts.filter(p => p.stock > 0 && p.stock <= p.minStock && p.isConfigured).length;
    const outOfStockProducts = relevantProducts.filter(p => p.stock === 0).length;
    const totalStockValue = relevantProducts.reduce((sum, p) => sum + (p.stockValue || 0), 0);
    const totalQuantitySold = filteredSales.reduce((sum, sale) => sum + sale.quantity, 0);

    return {
      configuredProducts,
      inStockProducts,
      lowStockProducts,
      outOfStockProducts,
      totalStockValue,
      totalQuantitySold,
      totalRevenue
    };
  }, [products, registerSales, filters]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  };

  const getStockStatus = (product: Product) => {
    if (!product.isConfigured || !stockConfig[product.id]) {
      return { status: 'not-configured', color: 'text-gray-400', bg: 'bg-gray-500/20', label: 'Non configuré' };
    }
    if (product.stock === 0) {
      return { status: 'out-of-stock', color: 'text-red-400', bg: 'bg-red-500/20', label: 'Rupture' };
    }
    if (product.stock <= product.minStock) {
      return { status: 'low-stock', color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'Stock faible' };
    }
    return { status: 'in-stock', color: 'text-green-400', bg: 'bg-green-500/20', label: 'En stock' };
  };

  const handleSort = (field: keyof Product) => {
    setFilters(prev => ({
      ...prev,
      sortField: field,
      sortDirection: prev.sortField === field && prev.sortDirection === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    setShowEditModal(true);
  };

  const handleSaveProduct = async (productData: Partial<Product>) => {
    if (!editingProduct || !updateStockConfig) return;

    setIsUpdating(true);
    try {
      await updateStockConfig(editingProduct.id, {
        initialStock: productData.initialStock || 0,
        initialStockDate: productData.initialStockDate || format(new Date(), 'yyyy-MM-dd'),
        minStock: productData.minStock || 5
      });
      
      setShowEditModal(false);
      setEditingProduct(null);
      onRefreshData();
    } catch (error) {
      console.error('Error updating product:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSyncProducts = async () => {
    setSyncStatus({ syncing: true });
    try {
      await autoSyncProductsFromSales();
      setSyncStatus({ 
        syncing: false, 
        success: true, 
        message: `Synchronisation réussie. ${products.length} produits détectés.` 
      });
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSyncStatus({ syncing: false });
      }, 3000);
    } catch (error) {
      console.error('Error syncing products:', error);
      setSyncStatus({ 
        syncing: false, 
        success: false, 
        message: 'Erreur lors de la synchronisation.' 
      });
    }
  };

  const handleExport = () => {
    const exportData = filteredProducts.map(product => ({
      Produit: product.name,
      Catégorie: product.category,
      'Prix Moyen': product.price,
      'Stock Initial': product.initialStock || 0,
      'Quantité Vendue': product.quantitySold || 0,
      'Stock Final': product.stock,
      'Stock Minimum': product.minStock,
      'Valeur Stock': product.stockValue || 0,
      'Date Effet': product.initialStockDate || '',
      'Dernière Vente': product.lastSale ? format(product.lastSale, 'dd/MM/yyyy') : '',
      'Statut': getStockStatus(product).label,
      'Configuré': product.isConfigured ? 'Oui' : 'Non'
    }));
    
    exportToExcel(exportData, `stock-${format(new Date(), 'yyyy-MM-dd')}`);
  };

  const clearFilters = () => {
    setFilters({
      searchTerm: '',
      dateRange: {
        start: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
        end: format(new Date(), 'yyyy-MM-dd')
      },
      register: 'all',
      category: 'all',
      seller: 'all',
      stockStatus: 'all',
      sortField: 'name',
      sortDirection: 'asc'
    });
  };

  const hasActiveFilters = filters.searchTerm || 
    filters.register !== 'all' || 
    filters.category !== 'all' || 
    filters.seller !== 'all' || 
    filters.stockStatus !== 'all' ||
    filters.dateRange.start !== format(subDays(new Date(), 30), 'yyyy-MM-dd') ||
    filters.dateRange.end !== format(new Date(), 'yyyy-MM-dd');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-6 h-6 border border-blue-400/30 border-t-blue-400 rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Gestion du Stock</h1>
          <p className="text-slate-400">Produits extraits automatiquement des données de vente</p>
        </div>
        
        <div className="flex space-x-3">
          {/* Sync Button with Status */}
          <div className="relative">
            <button
              onClick={handleSyncProducts}
              disabled={syncStatus.syncing}
              className="bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold 
                         py-3 px-6 rounded-xl hover:from-purple-600 hover:to-purple-700 
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-all duration-200 flex items-center space-x-2"
            >
              {syncStatus.syncing ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Zap className="w-5 h-5" />
              )}
              <span>Synchroniser</span>
            </button>
            
            {/* Success/Error Message */}
            <AnimatePresence>
              {syncStatus.message && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className={`absolute top-full right-0 mt-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap ${
                    syncStatus.success 
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                      : 'bg-red-500/20 text-red-400 border border-red-500/30'
                  }`}
                >
                  {syncStatus.message}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          <button
            onClick={onRefreshData}
            className="bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold 
                       py-3 px-6 rounded-xl hover:from-blue-600 hover:to-blue-700 
                       transition-all duration-200 flex items-center space-x-2"
          >
            <RefreshCw className="w-5 h-5" />
            <span>Actualiser</span>
          </button>
          
          <button
            onClick={handleExport}
            className="bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold 
                       py-3 px-6 rounded-xl hover:from-green-600 hover:to-green-700 
                       transition-all duration-200 flex items-center space-x-2"
          >
            <Download className="w-5 h-5" />
            <span>Exporter</span>
          </button>
        </div>
      </div>

      {/* No Products Notice */}
      {products.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-6 text-center"
        >
          <Package className="w-16 h-16 text-blue-400 mx-auto mb-4 opacity-50" />
          <h3 className="text-xl font-semibold text-white mb-2">Aucun produit détecté</h3>
          <p className="text-slate-400 mb-6">
            Les produits sont automatiquement extraits des données de vente.
            <br />
            Importez des ventes ou utilisez le bouton "Synchroniser" pour détecter les produits.
          </p>
          
          <button
            onClick={handleSyncProducts}
            disabled={syncStatus.syncing}
            className="bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold 
                       py-3 px-6 rounded-xl hover:from-blue-600 hover:to-blue-700 
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200 inline-flex items-center space-x-2"
          >
            {syncStatus.syncing ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Zap className="w-5 h-5" />
            )}
            <span>Synchroniser maintenant</span>
          </button>
        </motion.div>
      )}

      {/* Statistics Cards */}
      {products.length > 0 && <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-gradient-to-br from-green-500/10 to-green-600/10 backdrop-blur-xl 
                     border border-green-500/20 rounded-xl p-4"
        >
          <div className="flex items-center space-x-3">
            <CreditCard className="w-6 h-6 text-green-400" />
            <div>
              <p className="text-slate-400 text-sm">CA Total</p>
              <p className="text-xl font-bold text-white">{formatCurrency(statistics.totalRevenue)}</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 backdrop-blur-xl 
                     border border-purple-500/20 rounded-xl p-4"
        >
          <div className="flex items-center space-x-3">
            <Settings className="w-6 h-6 text-purple-400" />
            <div>
              <p className="text-slate-400 text-sm">Configurés</p>
              <p className="text-2xl font-bold text-white">{statistics.configuredProducts}</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-gradient-to-br from-green-500/10 to-green-600/10 backdrop-blur-xl 
                     border border-green-500/20 rounded-xl p-4"
        >
          <div className="flex items-center space-x-3">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <div>
              <p className="text-slate-400 text-sm">En Stock</p>
              <p className="text-2xl font-bold text-white">{statistics.inStockProducts}</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="bg-gradient-to-br from-orange-500/10 to-orange-600/10 backdrop-blur-xl 
                     border border-orange-500/20 rounded-xl p-4"
        >
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-6 h-6 text-orange-400" />
            <div>
              <p className="text-slate-400 text-sm">Stock Faible</p>
              <p className="text-2xl font-bold text-white">{statistics.lowStockProducts}</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="bg-gradient-to-br from-red-500/10 to-red-600/10 backdrop-blur-xl 
                     border border-red-500/20 rounded-xl p-4"
        >
          <div className="flex items-center space-x-3">
            <X className="w-6 h-6 text-red-400" />
            <div>
              <p className="text-slate-400 text-sm">Rupture</p>
              <p className="text-2xl font-bold text-white">{statistics.outOfStockProducts}</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/10 backdrop-blur-xl 
                     border border-cyan-500/20 rounded-xl p-4"
        >
          <div className="flex items-center space-x-3">
            <CreditCard className="w-6 h-6 text-cyan-400" />
            <div>
              <p className="text-slate-400 text-sm">Valeur Stock</p>
              <p className="text-xl font-bold text-white">{formatCurrency(statistics.totalStockValue)}</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          className="bg-gradient-to-br from-yellow-500/10 to-yellow-600/10 backdrop-blur-xl 
                     border border-yellow-500/20 rounded-xl p-4"
        >
          <div className="flex items-center space-x-3">
            <TrendingUp className="w-6 h-6 text-yellow-400" />
            <div>
              <p className="text-slate-400 text-sm">Quantité Vendue</p>
              <p className="text-2xl font-bold text-white">{statistics.totalQuantitySold}</p>
            </div>
          </div>
        </motion.div>
      </div>}

      {/* Smart Filters */}
      {products.length > 0 && <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Filter className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold text-white">Filtres Intelligents</h3>
            {hasActiveFilters && (
              <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full text-xs">
                {filteredProducts.length} résultats
              </span>
            )}
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors duration-200"
            >
              {showFilters ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              <span className="text-sm">{showFilters ? 'Masquer' : 'Afficher'}</span>
            </button>
            
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-sm text-slate-400 hover:text-white transition-colors duration-200 
                           bg-slate-700/50 hover:bg-slate-700 px-3 py-1 rounded-lg"
              >
                Effacer
              </button>
            )}
          </div>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4"
            >
              {/* Search and Date Range */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Rechercher un produit..."
                    value={filters.searchTerm}
                    onChange={(e) => setFilters(prev => ({ ...prev, searchTerm: e.target.value }))}
                    className="w-full pl-10 pr-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white
                               placeholder-slate-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Date de début</label>
                  <input
                    type="date"
                    value={filters.dateRange.start}
                    onChange={(e) => setFilters(prev => ({ 
                      ...prev, 
                      dateRange: { ...prev.dateRange, start: e.target.value }
                    }))}
                    className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white
                               focus:outline-none focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Date de fin</label>
                  <input
                    type="date"
                    value={filters.dateRange.end}
                    onChange={(e) => setFilters(prev => ({ 
                      ...prev, 
                      dateRange: { ...prev.dateRange, end: e.target.value }
                    }))}
                    className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white
                               focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Dropdown Filters */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <select
                  value={filters.register}
                  onChange={(e) => setFilters(prev => ({ ...prev, register: e.target.value }))}
                  className="px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white
                             focus:outline-none focus:border-blue-500"
                >
                  <option value="all">Toutes les caisses</option>
                  {uniqueRegisters.map(register => (
                    <option key={register} value={register}>{register}</option>
                  ))}
                </select>
                
                <select
                  value={filters.category}
                  onChange={(e) => setFilters(prev => ({ ...prev, category: e.target.value }))}
                  className="px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white
                             focus:outline-none focus:border-blue-500"
                >
                  <option value="all">Toutes les catégories</option>
                  {uniqueCategories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                
                <select
                  value={filters.seller}
                  onChange={(e) => setFilters(prev => ({ ...prev, seller: e.target.value }))}
                  className="px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white
                             focus:outline-none focus:border-blue-500"
                >
                  <option value="all">Tous les vendeurs</option>
                  {uniqueSellers.map(seller => (
                    <option key={seller} value={seller}>{seller}</option>
                  ))}
                </select>
                
                <select
                  value={filters.stockStatus}
                  onChange={(e) => setFilters(prev => ({ ...prev, stockStatus: e.target.value as any }))}
                  className="px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white
                             focus:outline-none focus:border-blue-500"
                >
                  <option value="all">Tous les statuts</option>
                  <option value="in-stock">En stock</option>
                  <option value="low-stock">Stock faible</option>
                  <option value="out-of-stock">Rupture</option>
                  <option value="not-configured">Non configuré</option>
                </select>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>}

      {/* Products Table */}
      {products.length > 0 && <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }} 
        className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-xl p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-white">
            Produits ({filteredProducts.length})
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                {[
                  { key: 'name', label: 'Produit' },
                  { key: 'category', label: 'Catégorie' },
                  { key: 'price', label: 'Prix Moyen' },
                  { key: 'initialStock', label: 'Stock Initial' },
                  { key: 'quantitySold', label: 'Vendu' },
                  { key: 'stock', label: 'Stock Final' },
                  { key: 'minStock', label: 'Stock Min' },
                  { key: 'stockValue', label: 'Valeur' },
                  { key: 'lastSale', label: 'Dernière Vente' },
                  { key: 'status', label: 'Statut' }
                ].map(({ key, label }) => (
                  <th
                    key={key}
                    className="text-left py-3 px-4 text-slate-400 font-medium cursor-pointer hover:text-white
                               transition-colors duration-200"
                    onClick={() => handleSort(key as keyof Product)}
                  >
                    <div className="flex items-center space-x-1">
                      <span>{label}</span>
                      <ArrowUpDown className="w-4 h-4" />
                    </div>
                  </th>
                ))}
                <th className="text-left py-3 px-4 text-slate-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product, index) => {
                const status = getStockStatus(product);
                
                return (
                  <motion.tr
                    key={product.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.01 }}
                    className="border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors duration-200"
                  >
                    <td className="py-3 px-4 text-white font-medium">{product.name}</td>
                    <td className="py-3 px-4">
                      <span className="bg-purple-500/20 text-purple-400 px-2 py-1 rounded-full text-xs font-medium">
                        {product.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-300">{formatCurrency(product.price)}</td>
                    <td className="py-3 px-4 text-center text-white font-medium">
                      {product.initialStock || 0}
                    </td>
                    <td className="py-3 px-4 text-center text-blue-400 font-medium">
                      {product.quantitySold || 0}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`font-bold ${
                        product.stock === 0 ? 'text-red-400' :
                        product.stock <= product.minStock ? 'text-orange-400' :
                        'text-green-400'
                      }`}>
                        {product.stock}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center text-slate-300">{product.minStock}</td>
                    <td className="py-3 px-4 text-slate-300">{formatCurrency(product.stockValue || 0)}</td>
                    <td className="py-3 px-4 text-slate-300 text-sm">
                      {product.lastSale ? format(product.lastSale, 'dd/MM/yyyy') : '-'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.bg} ${status.color}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex space-x-2">
                        <button 
                          onClick={() => handleEditProduct(product)}
                          className="p-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 
                                     transition-all duration-200"
                          title="Configurer le stock"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          
          {filteredProducts.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Aucun produit trouvé</p>
              {hasActiveFilters && (
                <p className="text-sm mt-1">Essayez de modifier vos filtres</p>
              )}
            </div>
          )}
        </div>
      </motion.div>}

      {/* Product Edit Modal */}
      {showEditModal && editingProduct && (
        <ProductEditModal
          product={editingProduct}
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setEditingProduct(null);
          }}
          onSave={handleSaveProduct}
          isLoading={isUpdating}
          allSales={registerSales}
          stockConfig={stockConfig}
        />
      )}
    </div>
  );
}