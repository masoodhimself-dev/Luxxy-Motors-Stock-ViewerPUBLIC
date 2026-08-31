import { getGetVehicleQueryKey, useGetVehicle } from '@workspace/api-client-react';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Button, ErrorState, LoadingState, Screen } from '@/components/LuxxyUI';
import { formatMileage, formatPrice, getApiErrorMessage, getVehicleLabel } from '@/lib/api';
import { dealer } from '@/lib/dealer';
import { useColors } from '@/hooks/useColors';

async function openUrl(url: string, fallback?: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error('Unsupported URL');
    await Linking.openURL(url);
  } catch {
    if (fallback) Alert.alert('Unable to open link', fallback);
    else Alert.alert('Unable to open link', 'Please try again or use the contact details below.');
  }
}

export default function VehicleDetailScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const query = useGetVehicle(id, { query: { queryKey: getGetVehicleQueryKey(id), enabled: Boolean(id), staleTime: 60_000 } });
  const vehicle = query.data;
  const [imageIndex, setImageIndex] = useState(0);
  const images = useMemo(() => {
    if (!vehicle) return [];
    return Array.from(new Set([vehicle.heroImage, ...vehicle.images.map((image) => image.url)].filter((value): value is string => Boolean(value))));
  }, [vehicle]);
  const label = vehicle ? getVehicleLabel(vehicle) : 'Vehicle';
  const address = dealer.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dealer.address)}`;

  if (query.isLoading) return <Screen><LoadingState label="Loading vehicle details…" /></Screen>;
  if (query.isError || !vehicle) return <Screen><ErrorState message={getApiErrorMessage(query.error, 'This vehicle may no longer be available.')} onRetry={() => void query.refetch()} /></Screen>;

  const specifications = vehicle.specifications && typeof vehicle.specifications === 'object'
    ? Object.entries(vehicle.specifications).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    : [];

  return (
    <Screen>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back to showroom" hitSlop={10} style={styles.backButton}><Text style={[styles.backText, { color: colors.foreground }]}>‹</Text></Pressable>
        <Text numberOfLines={1} style={[styles.topTitle, { color: colors.foreground }]}>{label}</Text>
        <Pressable onPress={() => void openUrl(`tel:${dealer.phone}`)} accessibilityRole="button" accessibilityLabel="Call Luxxy Motors" hitSlop={10}><Text style={[styles.callText, { color: colors.primary }]}>Call</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.galleryWrap}>
          {images.length ? (
            <FlatList
              data={images}
              horizontal
              pagingEnabled
              keyExtractor={(item, index) => `${item}-${index}`}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) => setImageIndex(Math.round(event.nativeEvent.contentOffset.x / event.nativeEvent.layoutMeasurement.width))}
              renderItem={({ item }) => <Image source={{ uri: item }} contentFit="cover" transition={180} style={[styles.galleryImage, { width }]} accessibilityLabel={`${label} gallery image`} />}
            />
          ) : <View style={[styles.galleryImage, styles.noImage, { backgroundColor: colors.secondary }]}><Text style={{ color: colors.mutedForeground }}>Photo unavailable</Text></View>}
          {images.length > 1 ? <View style={styles.dots} accessibilityLabel={`${imageIndex + 1} of ${images.length} photos`}>{images.map((item, index) => <View key={`${item}-dot`} style={[styles.dot, { backgroundColor: index === imageIndex ? colors.accent : colors.primaryForeground }]} />)}</View> : null}
        </View>
        <View style={styles.titleBlock}>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>AVAILABLE TO VIEW</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>{label}</Text>
          <Text style={[styles.price, { color: colors.foreground }]}>{formatPrice(vehicle.price, vehicle.currency || 'GBP')}</Text>
          {vehicle.writeOffCategory ? <View style={[styles.disclosure, { backgroundColor: colors.secondary }]}><Text style={[styles.disclosureText, { color: colors.foreground }]}>Category {vehicle.writeOffCategory} damage disclosure</Text></View> : null}
        </View>
        <View style={[styles.factGrid, { borderColor: colors.border }]}>
          {[
            ['Year', vehicle.year?.toString() || '—'],
            ['Mileage', formatMileage(vehicle.mileage, vehicle.mileageText)],
            ['Fuel', vehicle.fuel || '—'],
            ['Gearbox', vehicle.transmission || '—'],
            ['Body type', vehicle.bodyType || '—'],
            ['Colour', vehicle.colour || '—'],
          ].map(([heading, value]) => <View key={heading} style={[styles.fact, { borderBottomColor: colors.border }]}><Text style={[styles.factHeading, { color: colors.mutedForeground }]}>{heading}</Text><Text style={[styles.factValue, { color: colors.foreground }]}>{value}</Text></View>)}
        </View>
        <View style={styles.actions}>
          <Button label="Book a viewing" icon="calendar" onPress={() => router.push({ pathname: '/booking', params: { vehicleId: vehicle.id, vehicleTitle: label } })} testID="button-book-viewing" />
          <View style={styles.actionRow}>
            <View style={styles.half}><Button label="Call us" icon="phone" variant="outline" onPress={() => void openUrl(`tel:${dealer.phone}`)} /></View>
            <View style={styles.half}><Button label="WhatsApp" icon="message-circle" variant="outline" onPress={() => void openUrl(`https://wa.me/${dealer.whatsapp.replace(/[^0-9]/g, '')}`)} /></View>
          </View>
          <Button label="Get directions" icon="map-pin" variant="quiet" onPress={() => void openUrl(address)} />
        </View>
        <View style={[styles.disclosurePanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.panelTitle, { color: colors.foreground }]}>Vehicle information</Text>
          <Text style={[styles.panelCopy, { color: colors.mutedForeground }]}>Please confirm the latest details and availability with Luxxy Motors before travelling. Prices and stock can change.</Text>
          {vehicle.registration || vehicle.plate ? <Text style={[styles.panelMeta, { color: colors.foreground }]}>Registration: {vehicle.registration || vehicle.plate}</Text> : null}
          {vehicle.owners != null ? <Text style={[styles.panelMeta, { color: colors.foreground }]}>Previous keepers: {vehicle.owners}</Text> : null}
          {specifications.length ? <View style={[styles.specList, { borderTopColor: colors.border }]}>{specifications.slice(0, 8).map(([key, value]) => <View key={key} style={styles.specRow}><Text style={[styles.panelMeta, { color: colors.mutedForeground }]}>{key.replace(/([A-Z])/g, ' $1')}</Text><Text style={[styles.panelMeta, { color: colors.foreground }]}>{String(value)}</Text></View>)}</View> : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { width: 30, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { fontFamily: 'Inter_400Regular', fontSize: 36, lineHeight: 36 },
  topTitle: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  callText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  content: { paddingBottom: 40 },
  galleryWrap: { height: 270, position: 'relative' },
  galleryImage: { width: 390, height: 270 },
  noImage: { alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', bottom: 14, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, opacity: 0.9 },
  titleBlock: { paddingHorizontal: 20, paddingTop: 23, paddingBottom: 18 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 32, marginTop: 7 },
  price: { fontFamily: 'Inter_700Bold', fontSize: 24, marginTop: 10 },
  disclosure: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, marginTop: 13 },
  disclosureText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  factGrid: { marginHorizontal: 20, borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap' },
  fact: { width: '50%', minHeight: 66, paddingVertical: 13, borderBottomWidth: 1 },
  factHeading: { fontFamily: 'Inter_400Regular', fontSize: 12, marginBottom: 4 },
  factValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, paddingRight: 6 },
  actions: { paddingHorizontal: 20, paddingTop: 20, gap: 10 },
  actionRow: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  disclosurePanel: { margin: 20, marginBottom: 0, padding: 17, borderRadius: 14, borderWidth: 1, gap: 8 },
  panelTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  panelCopy: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  panelMeta: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  specList: { borderTopWidth: 1, paddingTop: 8, marginTop: 2, gap: 7 },
  specRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});