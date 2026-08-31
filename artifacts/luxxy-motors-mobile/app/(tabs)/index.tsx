import { getGetStockQueryKey, useGetStock, type Vehicle } from '@workspace/api-client-react';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, ErrorState, FilterChip, LogoHero, SearchField, Screen, VehicleCard } from '@/components/LuxxyUI';
import { getApiErrorMessage } from '@/lib/api';
import { dealer } from '@/lib/dealer';
import { useColors } from '@/hooks/useColors';

export default function ShowroomScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [make, setMake] = useState('');
  const [noWriteOff, setNoWriteOff] = useState(false);
  const stockQuery = useGetStock({ query: { queryKey: getGetStockQueryKey(), staleTime: 60_000, retry: 2 } });
  const cars = stockQuery.data?.cars ?? [];
  const makes = useMemo(() => Array.from(new Set(cars.map((car) => car.make).filter((value): value is string => Boolean(value)))).sort(), [cars]);
  const filteredCars = useMemo(() => {
    const query = search.trim().toLowerCase();
    return cars.filter((car) => {
      const matchesSearch = !query || [car.title, car.make, car.model, car.registration, car.plate].some((value) => value?.toLowerCase().includes(query));
      const matchesMake = !make || car.make === make;
      const matchesDamage = !noWriteOff || !car.writeOffCategory;
      return matchesSearch && matchesMake && matchesDamage;
    });
  }, [cars, make, noWriteOff, search]);

  if (stockQuery.isLoading) return <Screen><View style={styles.center}><LogoHero /><View style={styles.loadingBox}><Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading today’s stock…</Text></View></View></Screen>;
  if (stockQuery.isError && !stockQuery.data) return <Screen><ErrorState message={getApiErrorMessage(stockQuery.error, 'Check your connection and try again.')} onRetry={() => void stockQuery.refetch()} /></Screen>;

  return (
    <Screen>
      <FlatList<Vehicle>
        data={filteredCars}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <VehicleCard vehicle={item} />}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 90 }]}
        refreshControl={<RefreshControl refreshing={stockQuery.isFetching && !stockQuery.isLoading} onRefresh={() => void stockQuery.refetch()} tintColor={colors.accent} colors={[colors.accent]} />}
        ListHeaderComponent={
          <View>
            <LogoHero />
            <SearchField value={search} onChangeText={setSearch} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <FilterChip label="All makes" active={!make} onPress={() => setMake('')} />
              {makes.slice(0, 6).map((value) => <FilterChip key={value} label={value} active={make === value} onPress={() => setMake(value)} />)}
              <FilterChip label="HPI clear" active={noWriteOff} onPress={() => setNoWriteOff((current) => !current)} />
            </ScrollView>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={[styles.eyebrow, { color: colors.accent }]}>THE SHOWROOM</Text>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{filteredCars.length} {filteredCars.length === 1 ? 'vehicle' : 'vehicles'} available</Text>
              </View>
              {search || make || noWriteOff ? <Pressable onPress={() => { setSearch(''); setMake(''); setNoWriteOff(false); }} accessibilityRole="button" accessibilityLabel="Clear all filters"><Text style={[styles.clearText, { color: colors.primary }]}>Clear</Text></Pressable> : null}
            </View>
            {stockQuery.isError ? <Text style={[styles.refreshNote, { color: colors.destructive }]}>Showing the last loaded stock. Pull to refresh when you’re back online.</Text> : null}
            <View style={[styles.services, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.servicesTitle, { color: colors.foreground }]}>More from Luxxy</Text>
              <Text style={[styles.servicesCopy, { color: colors.mutedForeground }]}>Buying support, delivery and part-exchange help from the same team.</Text>
              <View style={styles.serviceGrid}>
                {dealer.services.map((service) => (
                  <Pressable
                    key={service.type}
                    onPress={() => router.push({ pathname: '/contact', params: { type: service.type } })}
                    accessibilityRole="button"
                    accessibilityLabel={service.title}
                    style={({ pressed }) => [styles.serviceItem, { backgroundColor: colors.secondary, opacity: pressed ? 0.75 : 1 }]}
                  >
                    <Text style={[styles.serviceTitle, { color: colors.foreground }]}>{service.title}</Text>
                    <Text style={[styles.serviceDescription, { color: colors.mutedForeground }]}>{service.description}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={<EmptyState />}
        ListFooterComponent={
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Text style={[styles.footerTitle, { color: colors.foreground }]}>Need a hand?</Text>
            <Text style={[styles.footerCopy, { color: colors.mutedForeground }]}>Our team is in {dealer.location} and ready to help.</Text>
            <Button label="Ask Luxxy Motors" icon="message-circle" variant="outline" onPress={() => router.push({ pathname: '/contact', params: { type: 'general' } })} />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  loadingBox: { alignItems: 'center', paddingTop: 28 },
  loadingText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  listContent: { paddingHorizontal: 16, paddingTop: 0 },
  chips: { gap: 8, paddingVertical: 14 },
  gridRow: { gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: 10, paddingBottom: 14 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.4 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 21, marginTop: 4 },
  clearText: { fontFamily: 'Inter_700Bold', fontSize: 13, padding: 8 },
  refreshNote: { fontFamily: 'Inter_400Regular', fontSize: 12, marginBottom: 12 },
  services: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 18 },
  servicesTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  servicesCopy: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 13 },
  serviceGrid: { gap: 8 },
  serviceItem: { borderRadius: 11, padding: 12 },
  serviceTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  serviceDescription: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
  footer: { marginTop: 12, borderTopWidth: 1, paddingTop: 22, gap: 8 },
  footerTitle: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  footerCopy: { fontFamily: 'Inter_400Regular', fontSize: 14, marginBottom: 8 },
});