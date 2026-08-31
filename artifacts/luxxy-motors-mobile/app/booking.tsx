import { getGetEnquiryAvailabilityQueryKey, useCreateEnquiry, useGetEnquiryAvailability, type EnquiryInput } from '@workspace/api-client-react';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Field, LoadingState, Screen } from '@/components/LuxxyUI';
import { formatAppointment, getApiErrorMessage } from '@/lib/api';
import { useColors } from '@/hooks/useColors';

const timezone = 'Europe/London';
function londonDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function bookingDates() {
  const today = londonDate(new Date());
  const dates: string[] = [];
  for (let offset = 0; offset <= 30 && dates.length < 14; offset += 1) {
    const value = addDays(today, offset);
    if (new Date(`${value}T00:00:00Z`).getUTCDay() !== 0) dates.push(value);
  }
  return dates;
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00Z`));
}

export default function BookingScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ vehicleId?: string; vehicleTitle?: string }>();
  const dates = useMemo(bookingDates, []);
  const [selectedDate, setSelectedDate] = useState(dates[0] || londonDate(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const availability = useGetEnquiryAvailability({ date: selectedDate }, { query: { queryKey: getGetEnquiryAvailabilityQueryKey({ date: selectedDate }), staleTime: 30_000 } });
  const mutation = useCreateEnquiry();
  const slots = availability.data?.slots ?? [];

  const submit = () => {
    const validSlot = slots.some((slot) => slot.startAt === selectedSlot && slot.available);
    if (name.trim().length < 2) { Alert.alert('Add your name', 'Please enter at least two characters.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { Alert.alert('Check your email', 'We need a valid email address to confirm your viewing.'); return; }
    if (!validSlot || !selectedSlot) { Alert.alert('Choose another time', 'That slot is no longer available. Refresh the times and choose an available slot.'); void availability.refetch(); return; }
    const data: EnquiryInput = {
      vehicleId: typeof params.vehicleId === 'string' ? params.vehicleId : null,
      type: 'viewing',
      customerName: name.trim(),
      email: email.trim(),
      phone: null,
      preferredContact: 'email',
      message: message.trim() || `Viewing request for ${params.vehicleTitle || 'a vehicle'}.`,
      appointmentAt: selectedSlot,
    };
    mutation.mutate({ data }, {
      onSuccess: (result) => setSubmitted(result.appointmentAt || selectedSlot),
      onError: (error) => Alert.alert('Could not book that viewing', getApiErrorMessage(error, 'The slot may have just been taken. Refresh and try another time.')),
    });
  };

  if (submitted) {
    return <Screen><View style={styles.success}><View style={[styles.successIcon, { backgroundColor: colors.accent }]}><Text style={[styles.check, { color: colors.accentForeground }]}>✓</Text></View><Text style={[styles.successEyebrow, { color: colors.accent }]}>REQUEST RECEIVED</Text><Text style={[styles.successTitle, { color: colors.foreground }]}>Your viewing is booked.</Text><Text style={[styles.successCopy, { color: colors.mutedForeground }]}>We’ll email you to confirm the details.</Text><View style={[styles.confirmation, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.confirmationLabel, { color: colors.mutedForeground }]}>YOUR APPOINTMENT</Text><Text style={[styles.confirmationDate, { color: colors.foreground }]}>{formatAppointment(submitted)}</Text>{params.vehicleTitle ? <Text style={[styles.confirmationVehicle, { color: colors.mutedForeground }]}>{params.vehicleTitle}</Text> : null}</View><Button label="Back to showroom" icon="arrow-left" variant="outline" onPress={() => router.replace('/')} /></View></Screen>;
  }

  return (
    <Screen>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}><Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}><Text style={[styles.backText, { color: colors.foreground }]}>‹</Text></Pressable><View style={{ flex: 1 }}><Text style={[styles.topTitle, { color: colors.foreground }]}>Book a viewing</Text>{params.vehicleTitle ? <Text numberOfLines={1} style={[styles.topSub, { color: colors.mutedForeground }]}>{params.vehicleTitle}</Text> : null}</View></View>
      <KeyboardAwareScrollViewCompat bottomOffset={24} contentContainerStyle={[styles.form, { paddingBottom: 40 }]} showsVerticalScrollIndicator={false}>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>Choose a 30-minute slot at our Harrow showroom. Times are shown in {timezone}.</Text>
        <Text style={[styles.label, { color: colors.foreground }]}>Choose a date</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
          {dates.map((date) => <Pressable key={date} onPress={() => { setSelectedDate(date); setSelectedSlot(null); }} accessibilityRole="button" accessibilityState={{ selected: date === selectedDate }} accessibilityLabel={`Choose ${dateLabel(date)}`} style={[styles.datePill, { backgroundColor: date === selectedDate ? colors.primary : colors.card, borderColor: date === selectedDate ? colors.primary : colors.border }]}><Text style={[styles.dateText, { color: date === selectedDate ? colors.primaryForeground : colors.foreground }]}>{dateLabel(date)}</Text></Pressable>)}
        </ScrollView>
        <Text style={[styles.label, { color: colors.foreground }]}>Available times</Text>
        {availability.isLoading ? <View style={styles.slotLoading}><Text style={{ color: colors.mutedForeground }}>Checking availability…</Text></View> : availability.isError ? <View style={[styles.inlineError, { backgroundColor: colors.secondary }]}><Text style={[styles.inlineErrorText, { color: colors.foreground }]}>{getApiErrorMessage(availability.error, 'Could not check availability.')}</Text><Button label="Refresh times" icon="refresh-cw" variant="outline" onPress={() => void availability.refetch()} /></View> : slots.filter((slot) => slot.available).length ? <View style={styles.slotGrid}>{slots.map((slot) => <Pressable key={slot.startAt} disabled={!slot.available} onPress={() => setSelectedSlot(slot.startAt)} accessibilityRole="button" accessibilityState={{ selected: selectedSlot === slot.startAt, disabled: !slot.available }} accessibilityLabel={`${slot.label}${slot.available ? '' : ', unavailable'}`} style={[styles.slot, { backgroundColor: selectedSlot === slot.startAt ? colors.accent : colors.card, borderColor: selectedSlot === slot.startAt ? colors.accent : colors.border, opacity: slot.available ? 1 : 0.38 }]}><Text style={[styles.slotText, { color: selectedSlot === slot.startAt ? colors.accentForeground : colors.foreground }]}>{slot.label}</Text></Pressable>)}</View> : <Text style={[styles.emptySlots, { color: colors.mutedForeground }]}>There are no remaining times on this date. Choose another day.</Text>}
        <View style={[styles.formDivider, { borderTopColor: colors.border }]} />
        <Text style={[styles.label, { color: colors.foreground }]}>Your details</Text>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Your full name" autoCapitalize="words" />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
        <Field label="Anything we should know? (optional)" value={message} onChangeText={setMessage} placeholder="Add a note for the team" multiline />
        <Button label={mutation.isPending ? 'Sending request…' : 'Confirm viewing request'} icon="calendar" onPress={submit} disabled={mutation.isPending || !selectedSlot} testID="button-submit-booking" />
        <Text style={[styles.privacy, { color: colors.mutedForeground }]}>Your details are only used to handle this enquiry and send your confirmation.</Text>
      </KeyboardAwareScrollViewCompat>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backText: { fontFamily: 'Inter_400Regular', fontSize: 36, lineHeight: 36, paddingRight: 4 },
  topTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  topSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  form: { padding: 20 },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginBottom: 24 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 15, marginBottom: 10 },
  dateRow: { gap: 8, paddingBottom: 25 },
  datePill: { minWidth: 86, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11, borderWidth: 1, alignItems: 'center' },
  dateText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 8 },
  slot: { width: '31%', minHeight: 45, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  slotText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  slotLoading: { minHeight: 45, justifyContent: 'center', marginBottom: 8 },
  inlineError: { padding: 13, borderRadius: 11, gap: 10, marginBottom: 8 },
  inlineErrorText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  emptySlots: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginBottom: 8 },
  formDivider: { borderTopWidth: 1, marginVertical: 24 },
  privacy: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 13 },
  success: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  successIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  check: { fontFamily: 'Inter_700Bold', fontSize: 32 },
  successEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.5 },
  successTitle: { fontFamily: 'Inter_700Bold', fontSize: 28, textAlign: 'center', marginTop: 8 },
  successCopy: { fontFamily: 'Inter_400Regular', fontSize: 15, marginTop: 10, marginBottom: 22 },
  confirmation: { width: '100%', borderRadius: 16, borderWidth: 1, padding: 18, alignItems: 'center', marginBottom: 22 },
  confirmationLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.2 },
  confirmationDate: { fontFamily: 'Inter_700Bold', fontSize: 16, textAlign: 'center', marginTop: 8 },
  confirmationVehicle: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', marginTop: 5 },
});