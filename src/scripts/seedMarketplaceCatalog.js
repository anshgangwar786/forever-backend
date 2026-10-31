import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Product } from '../models/product.model.js';
import { User } from '../models/user.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const seedProducts = async () => {
  console.log('Seeding Multi-Category Marketplace Catalog into MongoDB Atlas...');

  const uri = process.env.MONGODB_URI;
  const DB_NAME = process.env.DB_NAME || 'ecommerceDB';
  let connectionString = uri.includes('?') 
    ? uri.replace(/\/?\?/, `/${DB_NAME}?`) 
    : `${uri}/${DB_NAME}`;

  await mongoose.connect(connectionString, { serverSelectionTimeoutMS: 8000 });
  console.log('Connected to MongoDB Atlas');

  // Find Super Admin and Seller to associate as sellerId
  const adminUser = await User.findOne({ role: 'admin' });
  const sellerUser = await User.findOne({ role: 'seller' });
  const defaultSellerId = adminUser?._id || sellerUser?._id || null;
  const defaultStore = adminUser?.storeName || 'Vellora Official Store';

  const catalog = [
    // 1. ELECTRONICS
    {
      name: "Sony WH-1000XM5 Wireless Noise-Cancelling Headphones",
      description: "Industry-leading noise cancellation with eight microphones and Auto NC Optimizer. High-resolution audio, 30-hour battery life, and ultra-comfortable soft fit leather headband.",
      price: 349,
      discount: 20,
      image: [
        "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80",
        "https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800&q=80"
      ],
      category: "Electronics",
      subCategory: "Audio & Headphones",
      attributes: [{ name: "Color", values: ["Midnight Black", "Silver Gray"] }],
      variantImages: [
        { attribute: "Color", value: "Midnight Black", image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80" },
        { attribute: "Color", value: "Silver Gray", image: "https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800&q=80" }
      ],
      stock: 45,
      bestseller: true,
      ratingAverage: 4.8,
      ratingCount: 128,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },
    {
      name: "Vellora Minimalist Smartwatch Series 8",
      description: "Advanced health tracking with continuous optical heart rate, ECG, and blood oxygen monitoring. Precision machined aerospace-grade aluminum casing with an always-on edge-to-edge Retina display.",
      price: 199,
      discount: 15,
      image: [
        "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80",
        "https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=800&q=80"
      ],
      category: "Electronics",
      subCategory: "Wearables & Smartwatches",
      attributes: [
        { name: "Case Size", values: ["40mm", "44mm"] },
        { name: "Band Color", values: ["Obsidian", "Starlight", "Charcoal"] }
      ],
      variantPrices: [
        { attribute: "Case Size", value: "44mm", priceDelta: 30 }
      ],
      stock: 60,
      bestseller: true,
      ratingAverage: 4.7,
      ratingCount: 94,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },
    {
      name: "AcousticStudio 360 Bluetooth Speaker",
      description: "Room-filling 360-degree spatial sound with deep resonant bass and IPX7 waterproof durability. Precision acoustic engineering encased in tactile acoustic fabric with 24 hours of playback.",
      price: 129,
      discount: 25,
      image: [
        "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800&q=80",
        "https://images.unsplash.com/photo-1545454675-3531b543be5d?w=800&q=80"
      ],
      category: "Electronics",
      subCategory: "Audio & Headphones",
      attributes: [{ name: "Color", values: ["Matte Black", "Sandstone"] }],
      variantImages: [
        { attribute: "Color", value: "Matte Black", image: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800&q=80" },
        { attribute: "Color", value: "Sandstone", image: "https://images.unsplash.com/photo-1545454675-3531b543be5d?w=800&q=80" }
      ],
      stock: 35,
      bestseller: false,
      ratingAverage: 4.6,
      ratingCount: 42,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },
    {
      name: "ProType Precision Wireless Mechanical Keyboard",
      description: "Low-profile mechanical switches crafted for tactile speed and whisper-quiet typing. CNC aluminum top plate, multi-device Bluetooth 5.2 connectivity, and customized RGB backlighting.",
      price: 159,
      discount: 10,
      image: [
        "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&q=80",
        "https://images.unsplash.com/photo-1618384887929-16ec33fab9ef?w=800&q=80"
      ],
      category: "Electronics",
      subCategory: "Laptops",
      attributes: [{ name: "Switch Type", values: ["Tactile Brown", "Linear Red", "Clicky Blue"] }],
      variantPrices: [
        { attribute: "Switch Type", value: "Clicky Blue", priceDelta: 10 }
      ],
      stock: 50,
      bestseller: false,
      ratingAverage: 4.9,
      ratingCount: 67,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },

    // 2. FASHION & APPAREL
    {
      name: "Men Slim Fit Relaxed Selvedge Denim Jacket",
      description: "Classic 13.5oz raw selvedge denim jacket crafted on vintage shuttle looms. Features antique copper shank buttons, dual chest flap pockets, and reinforced felled seams.",
      price: 180,
      discount: 20,
      image: [
        "https://images.unsplash.com/photo-1495105787522-5334e3ffa0ef?w=800&q=80",
        "https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=800&q=80"
      ],
      category: "Fashion & Apparel",
      subCategory: "Men's Wear",
      sizes: ["S", "M", "L", "XL"],
      sizeStock: { "S": 15, "M": 20, "L": 15, "XL": 10 },
      variantPrices: [
        { attribute: "Size", value: "XL", priceDelta: 15 }
      ],
      stock: 60,
      bestseller: true,
      ratingAverage: 4.8,
      ratingCount: 88,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },
    {
      name: "Women Oversized Wool-Blend Double-Breasted Trench Coat",
      description: "Tailored from a heavyweight virgin wool and cashmere blend. Generous relaxed silhouette with storm flap detailing, horn buttons, and a removable waist tie belt.",
      price: 260,
      discount: 15,
      image: [
        "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=800&q=80",
        "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&q=80"
      ],
      category: "Fashion & Apparel",
      subCategory: "Women's Wear",
      sizes: ["XS", "S", "M", "L"],
      sizeStock: { "XS": 10, "S": 15, "M": 15, "L": 10 },
      stock: 50,
      bestseller: true,
      ratingAverage: 4.9,
      ratingCount: 112,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },
    {
      name: "Classic Canvas Low-Top Sneakers",
      description: "Heavyweight 12oz organic cotton canvas upper on vulcanized natural rubber gum outsoles. Removable cushioned insoles engineered for effortless everyday comfort.",
      price: 85,
      discount: 15,
      image: [
        "https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=800&q=80"
      ],
      category: "Fashion & Apparel",
      subCategory: "Footwear",
      sizes: ["US 8", "US 9", "US 10", "US 11", "US 12"],
      sizeStock: { "US 8": 10, "US 9": 15, "US 10": 15, "US 11": 10, "US 12": 5 },
      stock: 55,
      bestseller: true,
      ratingAverage: 4.8,
      ratingCount: 91,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },

    // 3. HOME & KITCHEN / COOKWARE
    {
      name: "Artisan Ceramic Pour-Over Dripper & Mug Set",
      description: "Handcrafted from durable stoneware with a semi-matte textured glaze. Features precision spiral ribs for optimal extraction rate and thermal stability during morning brewing.",
      price: 65,
      discount: 15,
      image: [
        "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80",
        "https://images.unsplash.com/photo-1577937927133-66ef06acdf18?w=800&q=80"
      ],
      category: "Home & Kitchen",
      subCategory: "Cookware",
      attributes: [{ name: "Finish", values: ["Matte Stone", "Speckled Cream"] }],
      variantImages: [
        { attribute: "Finish", value: "Matte Stone", image: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80" },
        { attribute: "Finish", value: "Speckled Cream", image: "https://images.unsplash.com/photo-1577937927133-66ef06acdf18?w=800&q=80" }
      ],
      stock: 35,
      bestseller: true,
      ratingAverage: 4.8,
      ratingCount: 52,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },
    {
      name: "Damascus Steel 8-Inch Chef Knife",
      description: "67 layers of high-carbon Japanese VG-10 steel forged for razor-sharp edge retention. Ergonomic octagonal hardwood handle balanced for precision kitchen cutting.",
      price: 110,
      discount: 20,
      image: [
        "https://images.unsplash.com/photo-1593618998160-e34014e67546?w=800&q=80"
      ],
      category: "Home & Kitchen",
      subCategory: "Cookware",
      attributes: [{ name: "Handle", values: ["Rosewood", "Pakkawood"] }],
      variantPrices: [
        { attribute: "Handle", value: "Pakkawood", priceDelta: 20 }
      ],
      stock: 25,
      bestseller: false,
      ratingAverage: 4.9,
      ratingCount: 88,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },
    {
      name: "Enameled Cast Iron Dutch Oven (5.5 Qt)",
      description: "Heavy-duty cast iron construction ensures even heat distribution and retention for slow braises, stews, and sourdough baking. Vibrant chip-resistant enamel exterior with tight-fitting lid.",
      price: 145,
      discount: 25,
      image: [
        "https://images.unsplash.com/photo-1590794056226-79ef3a8147e1?w=800&q=80"
      ],
      category: "Home & Kitchen",
      subCategory: "Cookware",
      attributes: [{ name: "Color", values: ["Ember Red", "Sage Green", "Matte Black"] }],
      stock: 20,
      bestseller: false,
      ratingAverage: 4.7,
      ratingCount: 35,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },

    // 4. BEAUTY & PERSONAL CARE
    {
      name: "Botanical Hyaluronic Acid & Vitamin C Serum",
      description: "Concentrated multi-molecular hyaluronic serum enriched with cold-pressed botanical vitamin C and squalane. Deeply hydrates, plumps, and restores a luminous barrier without heavy residue.",
      price: 54,
      discount: 15,
      image: [
        "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&q=80",
        "https://images.unsplash.com/photo-1617897903246-719242758050?w=800&q=80"
      ],
      category: "Beauty & Personal Care",
      subCategory: "Skincare",
      attributes: [{ name: "Size", values: ["30ml", "50ml"] }],
      variantPrices: [
        { attribute: "Size", value: "50ml", priceDelta: 22 }
      ],
      stock: 75,
      bestseller: true,
      ratingAverage: 4.9,
      ratingCount: 143,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },
    {
      name: "Rosewood & Bergamot Eau de Parfum (100ml)",
      description: "An evocative unisex fragrance blending top notes of Sicilian bergamot with smoked rosewood, vetiver, and subtle amber resin. Formulated in Grasse, France with organic grain alcohol.",
      price: 120,
      discount: 20,
      image: [
        "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=800&q=80",
        "https://images.unsplash.com/photo-1547887537-6158d64c35b3?w=800&q=80"
      ],
      category: "Beauty & Personal Care",
      subCategory: "Fragrances",
      attributes: [{ name: "Volume", values: ["50ml", "100ml"] }],
      variantPrices: [
        { attribute: "Volume", value: "50ml", priceDelta: -40 }
      ],
      stock: 35,
      bestseller: true,
      ratingAverage: 4.8,
      ratingCount: 76,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },

    // 5. SPORTS & FITNESS
    {
      name: "Natural Tree Rubber Grip Yoga Mat (5mm)",
      description: "Sustainably harvested non-slip natural rubber base with an ultra-absorbent microfiber top surface. Provides non-toxic joint cushioning and dependable traction during intensive practice.",
      price: 78,
      discount: 20,
      image: [
        "https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=800&q=80"
      ],
      category: "Sports & Fitness",
      subCategory: "Fitness Accessories",
      attributes: [{ name: "Color", values: ["Forest Green", "Slate Blue", "Charcoal"] }],
      stock: 40,
      bestseller: true,
      ratingAverage: 4.9,
      ratingCount: 68,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },
    {
      name: "Insulated Stainless Steel Hydration Flask (32oz)",
      description: "Double-wall vacuum insulation keeps beverages cold for 24 hours or steaming hot for 12 hours. Pro-grade 18/8 stainless steel, powder-coated sweat-free exterior, and leakproof sport lid.",
      price: 42,
      discount: 15,
      image: [
        "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=800&q=80"
      ],
      category: "Sports & Fitness",
      subCategory: "Fitness Accessories",
      attributes: [
        { name: "Capacity", values: ["24oz", "32oz", "40oz"] },
        { name: "Color", values: ["Matte Black", "Desert Sand", "Alpine White"] }
      ],
      variantPrices: [
        { attribute: "Capacity", value: "24oz", priceDelta: -6 },
        { attribute: "Capacity", value: "40oz", priceDelta: 8 }
      ],
      stock: 90,
      bestseller: true,
      ratingAverage: 4.8,
      ratingCount: 115,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },

    // 6. ACCESSORIES & LEATHER
    {
      name: "Full-Grain Italian Leather Minimalist Wallet",
      description: "Hand-stitched vegetable-tanned leather from Tuscany. Slim bifold profile holds up to 8 cards and folded bills with integrated RFID blocking protection.",
      price: 68,
      discount: 20,
      image: [
        "https://images.unsplash.com/photo-1627123424574-724758594e93?w=800&q=80"
      ],
      category: "Fashion & Apparel",
      subCategory: "Accessories",
      attributes: [{ name: "Color", values: ["Espresso Brown", "Midnight Black", "Cognac Tan"] }],
      stock: 65,
      bestseller: true,
      ratingAverage: 4.8,
      ratingCount: 82,
      sellerId: defaultSellerId,
      storeName: defaultStore
    },
    {
      name: "Polarized Acetate Frame Sunglasses",
      description: "Handcrafted Italian Mazzucchelli acetate frames fitted with scratch-resistant polarized CR-39 lenses. Full UV400 protection with anti-reflective back coating.",
      price: 95,
      discount: 30,
      image: [
        "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=800&q=80"
      ],
      category: "Fashion & Apparel",
      subCategory: "Accessories",
      attributes: [{ name: "Frame", values: ["Tortoise Shell", "Matte Black", "Crystal Clear"] }],
      stock: 45,
      bestseller: true,
      ratingAverage: 4.7,
      ratingCount: 64,
      sellerId: defaultSellerId,
      storeName: defaultStore
    }
  ];

  for (const item of catalog) {
    const existing = await Product.findOne({ name: item.name });
    if (!existing) {
      await Product.create({
        ...item,
        date: Date.now() - Math.floor(Math.random() * 10000000)
      });
      console.log(`Created product in DB: ${item.name} (${item.category})`);
    } else {
      // Update fields to keep fresh
      await Product.updateOne({ _id: existing._id }, {
        $set: {
          price: item.price,
          discount: item.discount,
          category: item.category,
          subCategory: item.subCategory,
          image: item.image,
          stock: item.stock,
          attributes: item.attributes || [],
          sizes: item.sizes || [],
          sizeStock: item.sizeStock || {},
          variantImages: item.variantImages || [],
          variantPrices: item.variantPrices || [],
          bestseller: item.bestseller,
          ratingAverage: item.ratingAverage,
          ratingCount: item.ratingCount,
          storeName: defaultStore
        }
      });
      console.log(`Updated product in DB: ${item.name}`);
    }
  }

  const finalCount = await Product.countDocuments({});
  console.log(`Done! Total products in MongoDB Atlas: ${finalCount}`);
  await mongoose.disconnect();
};

seedProducts().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
