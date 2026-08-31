import { useCreateEnquiry, type EnquiryInput } from '@workspace/api-client-react';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Field, Screen } from '@/components/LuxxyUI';
import { getApiErrorMessage } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import type { EnquiryServiceType } from '@/lib/dealer';

const copy: Record<EnquiryServiceType, { title: string; intro: string; placeholder: string }> = {
  general: { title: 'Ask Luxxy Motors', intro: 'Tell us what you need and the team will get back to you by email.', placeholder: 'How can we help?' },
  delivery: { title: 'Ask about delivery', intro: 'We may be able to deliver your next car. Tell us where you’re based.', placeholder: 'Where would you like the car delivered?' },
  warranty: { title: 'Warranty enquiry', intro: 'Warranty options are available on eligible vehicles. Ask us for details.', placeholder: 'What would you like to know?' },
  part_exchange: { title: 'Value my car', intro: 'Share your registration and mileage for a part-exchange conversation.', placeholder: 'Registration, mileage, and anything else to note' },
};

export default function ContactScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ type?: EnquiryServiceType }>();
  const type: EnquiryServiceType = params.type && params.type in copy ? params.type : 'general';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const mutation = useCreateEnquiry();
  const content = copy[type];

  const submit = () => {
    if (name.trim().length < 2) { Alert.alert('Add your name', 'Please enter at least two characters.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { Alert.alert('Check your email', 'Please enter a valid email address.'); return; }
    if (message.trim().length < 1) { Alert.alert('Add a message', 'Tell us a little more so we can help.'); return; }
    const data: EnquiryInput = { vehicleId: null, type, customerName: name.trim(), email: email.trim(), phone: null, preferredContact: 'email', message: message.trim(), appointmentAt: null };
    mutation.mutate({ data }, {
      onSuccess: () => Alert.alert('Thanks — we’ve got it', 'The Luxxy Motors team will be in touch by email.', [{ text: 'Back to showroom', onPress: () => router.replace('/') }]),
      onError: (error) => Alert.alert('Could not send your enquiry', getApiErrorMessage(error, 'Please try again or call us directly.')),
    });
  };

  return (
    <Screen>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}><Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}><Text style={[styles.backText, { color: colors.foreground }]}>‹</Text></Pressable><Text style={[styles.topTitle, { color: colors.foreground }]}>{content.title}</Text></View>
      <KeyboardAwareScrollViewCompat bottomOffset={24} contentContainerStyle={styles.form} showsVerticalScrollIndicator={false}>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>{content.intro}</Text>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Your full name" autoCapitalize="words" />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
        <Field label="Message" value={message} onChangeText={setMessage} placeholder={content.placeholder} multiline />
        <Button label={mutation.isPending ? 'Sending…' : 'Send enquiry'} icon="send" onPress={submit} disabled={mutation.isPending} testID="button-submit-enquiry" />
        <Text style={[styles.privacy, { color: colors.mutedForeground }]}>We’ll use your email to reply to this enquiry.</Text>
      </KeyboardAwareScrollViewCompat>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backText: { fontFamily: 'Inter_400Regular', fontSize: 36, lineHeight: 36, paddingRight: 4 },
  topTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  form: { padding: 20, paddingBottom: 45 },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginBottom: 25 },
  privacy: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 13 },
});