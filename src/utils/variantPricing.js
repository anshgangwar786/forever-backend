/**
 * Variant pricing shared by cart/order code.
 * Keep in sync with frontend/src/utils/pricing.js — the storefront must show exactly what checkout charges.
 *
 * A cart line's variant label is the selected value of every attribute, in attribute order,
 * joined with " / " (e.g. "M" or "40mm / Obsidian"). Legacy products without attributes use the size alone.
 */
export const VARIANT_SEPARATOR = ' / ';

const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

const toPlainArray = (arr) => (Array.isArray(arr) ? arr : arr ? Array.from(arr) : []);

// Options a shopper chooses from; legacy products with only a `sizes` list behave like one "Size" option
export const getEffectiveAttributes = (product) => {
    const attributes = toPlainArray(product?.attributes).filter((a) => toPlainArray(a.values).length > 0);
    if (attributes.length > 0) return attributes;
    const sizes = toPlainArray(product?.sizes);
    return sizes.length > 0 ? [{ name: 'Size', values: sizes }] : [];
};

// Map of attribute name → selected value parsed from a variant label
export const parseVariantLabel = (product, label) => {
    const attributes = getEffectiveAttributes(product);
    const parts = String(label || '').split(VARIANT_SEPARATOR).map((p) => p.trim());
    const selected = {};
    attributes.forEach((attr, i) => {
        const values = toPlainArray(attr.values);
        if (values.includes(parts[i])) {
            selected[attr.name] = parts[i];
        } else {
            const match = parts.find((p) => values.includes(p));
            if (match) selected[attr.name] = match;
        }
    });
    return selected;
};

// Why this label isn't a purchasable option of the product, or null if it is
export const getVariantLabelError = (product, label) => {
    if (typeof label !== 'string' || !label.trim() || label.includes('.') || label.startsWith('$')) {
        return 'Invalid product option';
    }
    const attributes = getEffectiveAttributes(product);
    if (attributes.length > 0) {
        const selected = parseVariantLabel(product, label);
        const missing = attributes.find((a) => !selected[a.name]);
        return missing ? `Please select a ${missing.name} for '${product.name}'` : null;
    }
    return label === 'Standard' ? null : 'Invalid product option';
};

// The size value tracked in sizeStock for this label, if any
export const getVariantSizeValue = (product, label) => {
    const selected = parseVariantLabel(product, label);
    const sizeAttr = getEffectiveAttributes(product).find((a) => ['size', 'sizes'].includes(String(a.name).toLowerCase()));
    return sizeAttr && selected[sizeAttr.name] ? selected[sizeAttr.name] : null;
};

// Price before discount: base price plus the adjustment of every selected option
export const getVariantListPrice = (product, label) => {
    const selected = parseVariantLabel(product, label);
    const adjustments = toPlainArray(product?.variantPrices).reduce((sum, vp) => (
        selected[vp.attribute] === vp.value ? sum + (Number(vp.priceDelta) || 0) : sum
    ), 0);
    return Math.max(0, roundMoney((Number(product?.price) || 0) + adjustments));
};

// What the customer pays per unit
export const getUnitPrice = (product, label) => {
    const discount = Math.min(100, Math.max(0, Number(product?.discount) || 0));
    return roundMoney(getVariantListPrice(product, label) * (1 - discount / 100));
};

const getImageSrc = (img) => (typeof img === 'object' && img?.src ? img.src : img);

/**
 * Photo of the chosen option: the admin-assigned link when there is one, otherwise photos paired
 * with a non-size attribute by position when the counts match. Falls back to the main photo.
 * Same rule as getVariantImageLinks in frontend/src/utils/pricing.js.
 */
export const getVariantImage = (product, label) => {
    const images = toPlainArray(product?.image).map(getImageSrc).filter(Boolean);
    const selected = parseVariantLabel(product, label);
    let links = toPlainArray(product?.variantImages).filter((l) => images.includes(l.image));
    if (links.length === 0 && toPlainArray(product?.variantImages).length === 0 && images.length > 1) {
        const match = getEffectiveAttributes(product).find((a) => (
            !['size', 'sizes'].includes(String(a.name).toLowerCase()) && toPlainArray(a.values).length === images.length
        ));
        links = match ? toPlainArray(match.values).map((value, i) => ({ attribute: match.name, value, image: images[i] })) : [];
    }
    const link = links.find((l) => selected[l.attribute] === l.value);
    return link ? link.image : images[0];
};
