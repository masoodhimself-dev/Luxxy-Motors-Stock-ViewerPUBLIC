import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { formatMileage, formatPrice, getVehicleLabel } from '@/lib/api';
import type { Vehicle } from '@workspace/api-client-react';

export function Screen({ children, scroll = false, contentStyle }: {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: object;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const style = [styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }, contentStyle];
  if (scroll) {
    return <View style={style}>{children}</View>;
  }
  return <View style={style}>{children}</View>;
}

export function BrandHeader({ title = 'Luxxy Motors', subtitle, onBack }: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === 'web' ? 67 : 12, paddingBottom: 12 }]}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={12} style={styles.headerBack}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
      ) : null}
      <View style={styles.brandMark}>
        <View style={[styles.brandDot, { backgroundColor: colors.accent }]} />
        <Text style={[styles.brandText, { color: colors.foreground }]}>{title}</Text>
      </View>
      {subtitle ? <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function Button({ label, onPress, icon, variant = 'primary', disabled = false, testID }: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  variant?: 'primary' | 'outline' | 'quiet';
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const backgroundColor = variant === 'primary' ? colors.primary : variant === 'outline' ? 'transparent' : colors.secondary;
  const foreground = variant === 'primary' ? colors.primaryForeground : colors.foreground;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, borderColor: variant === 'outline' ? colors.border : backgroundColor, opacity: disabled ? 0.45 : pressed ? 0.76 : 1 },
      ]}
    >
      {icon ? <Feather name={icon} size={17} color={variant === 'primary' ? colors.accent : foreground} /> : null}
      <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', multiline = false, autoCapitalize = 'sentences' }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, { borderColor: colors.input, color: colors.foreground, backgroundColor: colors.card }, multiline && styles.multilineInput]}
      />
    </View>
  );
}

export function LogoHero() {
  const colors = useColors();
  return (
    <View style={[styles.hero, { backgroundColor: colors.primary }]}>
      <View style={[styles.heroGlow, { backgroundColor: colors.accent }]} />
      <Text style={[styles.eyebrow, { color: colors.accent }]}>QUALITY USED VEHICLES</Text>
      <Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>Find your next car.</Text>
      <Text style={[styles.heroCopy, { color: colors.primaryForeground }]}>Straightforward buying, carefully selected stock, and service that stays personal.</Text>
    </View>
  );
}

export function SearchField({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) {
  const colors = useColors();
  return (
    <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name="search" size={19} color={colors.mutedForeground} />
      <TextInput
        accessibilityLabel="Search showroom stock"
        value={value}
        onChangeText={onChangeText}
        placeholder="Search make, model or registration"
        placeholderTextColor={colors.mutedForeground}
        returnKeyType="search"
        style={[styles.searchInput, { color: colors.foreground }]}
      />
      {value ? <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="Clear search"><Feather name="x-circle" size={18} color={colors.mutedForeground} /></Pressable> : null}
    </View>
  );
}

export function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`Filter by ${label}`} style={[styles.chip, { backgroundColor: active ? colors.accent : colors.card, borderColor: active ? colors.accent : colors.border }]}>
      <Text style={[styles.chipText, { color: active ? colors.accentForeground : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function LoadingState({ label = 'Loading the showroom…' }: { label?: string }) {
  const colors = useColors();
  return <View style={styles.state}><ActivityIndicator size="large" color={colors.accent} /><Text style={[styles.stateTitle, { color: colors.foreground }]}>{label}</Text><Text style={[styles.stateCopy, { color: colors.mutedForeground }]}>Just a moment.</Text></View>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colors = useColors();
  return <View style={styles.state}><View style={[styles.stateIcon, { backgroundColor: colors.secondary }]}><Feather name="wifi-off" size={24} color={colors.foreground} /></View><Text style={[styles.stateTitle, { color: colors.foreground }]}>We couldn’t load that</Text><Text style={[styles.stateCopy, { color: colors.mutedForeground }]}>{message}</Text><Button label="Try again" onPress={onRetry} icon="refresh-cw" variant="outline" /></View>;
}

export function EmptyState({ title = 'No vehicles match', copy = 'Try a different make, model, or registration.' }: { title?: string; copy?: string }) {
  const colors = useColors();
  return <View style={styles.state}><View style={[styles.stateIcon, { backgroundColor: colors.secondary }]}><Feather name="search" size={24} color={colors.foreground} /></View><Text style={[styles.stateTitle, { color: colors.foreground }]}>{title}</Text><Text style={[styles.stateCopy, { color: colors.mutedForeground }]}>{copy}</Text></View>;
}

export function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const colors = useColors();
  const label = getVehicleLabel(vehicle);
  const image = vehicle.heroImage || vehicle.images[0]?.url;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`View ${label}`} testID={`vehicle-card-${vehicle.id}`} onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: vehicle.id } })} style={({ pressed }) => [styles.vehicleCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.82 : 1 }]}>
      <View style={styles.cardImageWrap}>
        {image ? <Image source={{ uri: image }} contentFit="cover" transition={180} style={styles.cardImage} accessibilityLabel={`${label} photo`} /> : <View style={[styles.cardImage, styles.imageFallback, { backgroundColor: colors.secondary }]}><Feather name="truck" size={28} color={colors.mutedForeground} /></View>}
        {vehicle.writeOffCategory ? <View style={[styles.disclosureBadge, { backgroundColor: colors.primary }]}><Text style={[styles.disclosureText, { color: colors.primaryForeground }]}>CAT {vehicle.writeOffCategory}</Text></View> : null}
      </View>
      <View style={styles.cardBody}>
        <Text numberOfLines={2} style={[styles.cardTitle, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.cardPrice, { color: colors.foreground }]}>{formatPrice(vehicle.price, vehicle.currency || 'GBP')}</Text>
        <Text numberOfLines={1} style={[styles.cardMeta, { color: colors.mutedForeground }]}>{[vehicle.year, formatMileage(vehicle.mileage, vehicle.mileageText), vehicle.transmission].filter(Boolean).join('  •  ')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  headerBack: { position: 'absolute', left: 18, bottom: 17, zIndex: 2, padding: 4 },
  brandMark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandDot: { width: 9, height: 9, borderRadius: 5 },
  brandText: { fontFamily: 'Inter_700Bold', fontSize: 17, letterSpacing: 0.3 },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 3 },
  button: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  hero: { marginHorizontal: 16, marginTop: 16, borderRadius: 24, padding: 24, minHeight: 220, overflow: 'hidden', justifyContent: 'flex-end' },
  heroGlow: { position: 'absolute', width: 180, height: 180, borderRadius: 90, right: -45, top: -50, opacity: 0.2 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.5, marginBottom: 9 },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 34, lineHeight: 39, letterSpacing: -1 },
  heroCopy: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, opacity: 0.8, maxWidth: 300, marginTop: 10 },
  searchBox: { marginHorizontal: 16, marginTop: 18, borderRadius: 13, borderWidth: 1, minHeight: 52, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, minHeight: 50 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  field: { gap: 7, marginBottom: 15 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  input: { minHeight: 50, borderRadius: 11, borderWidth: 1, paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 15 },
  multilineInput: { minHeight: 108, paddingTop: 13 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 10 },
  stateIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  stateTitle: { fontFamily: 'Inter_700Bold', fontSize: 19, textAlign: 'center' },
  stateCopy: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 310, marginBottom: 8 },
  vehicleCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 14 },
  cardImageWrap: { height: 170, position: 'relative' },
  cardImage: { width: '100%', height: '100%' },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  disclosureBadge: { position: 'absolute', top: 10, left: 10, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 },
  disclosureText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  cardBody: { padding: 14 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 21, minHeight: 42 },
  cardPrice: { fontFamily: 'Inter_700Bold', fontSize: 19, marginTop: 8 },
  cardMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 7 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});