import { Text, View } from 'react-native';

export default function HelloScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-[#0B0F14] px-6">
      <Text className="text-2xl font-bold text-white">Overlord</Text>
      <Text className="mt-2 text-center text-base text-neutral-400">
        Xindeler Ops Console — Phase 0 scaffold. No screens yet.
      </Text>
    </View>
  );
}
